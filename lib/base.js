var _ = require('lodash')
var knex

var models = {}
var noop = function () {}

module.exports = function init (connection) {
  knex = require('knex')(connection)

  var relatedMap = {}
  var hooks = {}
  var modelOpts = {}

  function Thing (thingData) {
    this._attributes = _.keys(thingData)
    _.extend(this, thingData)
  }

  /**
   * Make a thing about it
   *
   * @access public
   * @param {string} name The models name, like "User" or "Post"
   * @param {function} initialize Build the model
   * @return {Thing} An object extended from the base Thing
   */
  Thing.make = function make_new_thing (name, initialize) {
    var _static = {
      kind: name
    }
    var _proto = {
      kind: name
    }

    var _opts = modelOpts[name] = {
      table: name.toLowerCase() + 's'
    }
    var _related = relatedMap[name] = {}
    var _hook = hooks[name] = {
      before: {
        save: [],
        find: []
      },
      after: {
        init: [],
        validate: [],
        save: [],
        remove: []
      }
    }

    var constructor
    var assembler = {
      init: _.once(function (fn) {
        constructor = function _constructThing () {
          if (!(this instanceof _constructThing)) {
            throw new TypeError('Cannot call a class as a function')
          }

          var args = [].slice.call(arguments)

          var rootData = _.pick(args[0], function (v, k) {
            return !k.startsWith('$related_')
          })

          _.forIn(_related, function (opts, attr) {
            var relatedTable = opts.link.split('.')[0]
            var columnPrefix = `$related_${relatedTable}_`
            var relatedData = {}
            _.forIn(args[0], function (v, k) {
              if (k.startsWith(columnPrefix)) {
                relatedData[k.replace(columnPrefix, '')] = v
              }
            })
            if (_.keys(relatedData).length > 0) {
              rootData[attr] = relatedData;
            }
          })

          args[0] = rootData

          this.super = Thing
          Thing.apply(this, args)
          ;(fn || noop).call(this, args)
        }
      }),
      hasOne: function (attribute, opts) {
        _related[attribute] = _.extend({
          eager: true,
          join: 'innerJoin',
          relationship: 'hasOne'
        }, opts)
      },
      hasMany: function (attribute, opts) {
        _related[attribute] = _.extend({
          eager: false,
          join: false,
          relationship: 'hasMany'
        }, opts)
      },
      belongsTo: function (attribute, opts) {
        _related[attribute] = _.extend({
          eager: true,
          join: 'innerJoin',
          relationship: 'belongsTo'
        }, opts)
      },
      method: function (name, fn) {
        _proto[name] = fn
      },
      static: function (name, fn) {
        _static[name] = fn
      },
      before: function (hook, fn) {
        _hook.before[hook].push(fn)
      },
      after: function (hook, fn) {
        _hook.after[hook].push(fn)
      },
      behavior: function (fn) {
        fn.call(assembler, knex)
      }
    }

    _.each(['table', 'hidden', 'defaultFind'], function (key) {
      Object.defineProperty(assembler, key, {
        get: function () {
          return _opts[key]
        },
        set: function (to) {
          _opts[key] = to
        },
        enumerable: true
      })
    })

    initialize.call(assembler, knex)

    if (!_.isFunction(constructor)) {
      assembler.init()
    }

    _.extend(constructor, Thing, _static)
    _.extend(constructor.prototype, Thing.prototype, _proto)
    constructor.kind = name
    models[name] = constructor
    return constructor
  }

  var FIND_MODE_FIRST = 'first'
  var FIND_MODE_MANY = 'many'

  /**
   * Load many related things related to an array of IDs
   *
   * @access private
   * @param {array} thingIds An array of IDs
   * @param {string} attribute The related thing
   * @return {Promise} A promise that will resolve to a map ({ "thingId" => [relatedStuff], ... })
   */
  function batchRelatedLoad (thingIds, attribute) {
    var self = this
    var kind = self.kind
    var relatedOpts = relatedMap[kind][attribute]

    if (_.isObject(relatedOpts)) {
      var $tmp = relatedOpts.link.split('.')
      var table = $tmp[0]
      var fk = $tmp[1]

      return knex(table)
        .select(relatedOpts.columns)
        .whereIn(fk, thingIds)
        .then(function (result) {
          result = _.groupBy(result, fk)
          return _.mapValues(result, function (results) {
            if (relatedOpts.model) {
              return _.map(results, function (row) {
                return self.model(relatedOpts.model).forge(row)
              })
            } else {
              return results
            }
          })
        })
    } else {
      throw new Error('Unknown related attribute: ' + attribute)
    }
  }

  /**
   * The function responsible for receiving shit from the database
   *
   * @access private
   * @param {string} mode The query mode (first, many, etc.)
   * @param {object} opts Query options
   * @param {array} rows The database response
   */
  function queryComplete (mode, opts, rows) {
    var self = this

    if (rows.length === 0) {
      return Promise.resolve([])
    }

    if (mode === FIND_MODE_FIRST) {
      rows = [rows[0]]
    }

    if (opts.lean) {
      return Promise.resolve(rows)
    } else {
      rows = _.map(rows, function (record) {
        return self.forge(record)
      })
    }

    var todo = []
    _.forIn(relatedMap[this.kind], function (opts, attribute) {
      if (opts.eager && !opts.join) {
        todo.push(attribute)
      }
    })

    if (todo.length) {
      var thingsIds = _.map(rows, 'id')
      return Promise.all(_.map(todo, function (a) {
        return batchRelatedLoad.call(self, thingIds, relatedMap[self.kind][a])
      }))
        .then(function (results) {
          _.each(todo, function (attribute, idx) {
            _.forIn(results[idx], function (batchResult, id) {
              var thing = _.find(rows, { id: id })
              thing[attribute] = batchResult
            })
          })

          if (mode === FIND_MODE_FIRST) {
            return rows[0]
          }

          return rows
        })
    } else {
      return Promise.resolve(mode === FIND_MODE_FIRST ? rows[0] : rows)
    }
  }

  /**
   * Do some finding
   *
   * @access private
   * @param {string} mode The query mode (first, many, etc.)
   * @param {object} where Query constraints
   * @param {object} opts Query options
   */
  function find (mode, where, opts) {
    var Thing = this.prototype.constructor
    var _opts = modelOpts[Thing.kind]
    var table = _opts.table
    var self = this

    opts = opts || {}

    if (_.isString(opts.select) && opts.select.indexOf('*') === -1) {
      opts.select = opts.select.split(' ')
    }

    if (_.isArray(opts.select)) {
      opts.select = _.map(opts.select, function (c) {
        return `${table}.${c}`
      })
    }

    if (!opts.select) {
      opts.select = `${table}.*`
    }

    var stmt = knex.select(opts.select)
      .from(table)

    if (_.isFunction(where)) {
      where.call(stmt)
    } else if (_.isObject(where)) {
      _.extend(where, _opts.defaultWhere)

      var _where = {}
      _.forIn(where, function (val, key) {
        if (key.indexOf('.') === -1) {
          _where[`${table}.${key}`] = val
        } else {
          _where[key] = val
        }
      })

      stmt.where(_where)
    }

    processHooks.call(this, 'before', 'find', stmt)

    if (!opts.lean) {
      joinEager(Thing.kind, stmt)
    }

    if (mode === FIND_MODE_MANY) {
      if (opts.limit) {
        stmt.limit(opts.limit)
      }
    } else if (mode === FIND_MODE_FIRST) {
      stmt.limit(1)
    }

    return stmt
      .then(function (rows) {
        return queryComplete.call(self, mode, opts, rows)
      })
  }

  /**
   * Find one, wrapped
   *
   * @access public
   * @param {object} where Query constraints
   * @param {object} opts  Query options
   * @return {promise}     A promise that will return one result, or an error
   */
  Thing.find = function find_one_wrapper (where, opts) {
    return find.call(this, FIND_MODE_FIRST, where, opts)
  }

  /**
   * Find many, wrapped
   *
   * @access public
   * @param  {object} where Query constraints
   * @param  {object} opts  Query options
   * @return {promise}      A promise that will return the results, or an error
   */
  Thing.findMany = function find_many_wrapper (where, opts) {
    return find.call(this, FIND_MODE_MANY, where, opts)
  }

  function joinEager (thing, query) {
    var table = modelOpts[thing].table
    _.forIn(relatedMap[thing], function (opts, attribute) {
      if (opts.join && opts.eager) {
        if (_.isString(opts.link)) {
          var $tmp = opts.link.split('.')
          var joinTable = $tmp[0]
          query[opts.join].call(query, joinTable, `${table}.id`, opts.link)
          query.select(_.map(opts.columns, function (c) {
            return `${joinTable}.${c} as $related_${joinTable}_${c}`
          }))
        } else if (_.isFunction(opts.link)) {
          stmt[opts.join].call(stmt, opts.link)
        } else {
          throw new Error('related data link is a weird type')
        }
      }
    })

    return query
  }

  /**
   * Load a things related stuff
   * @param  {string} attribute The related attribute
   * @return {promise}          A promise that will return the related stuff, and also attach it to the parent
   */
  Thing.prototype.related = function (attribute) {
    var self = this
    var kind = this.constructor.kind
    var opts = relatedMap[kind][attribute]

    if (_.isObject(opts)) {
      var $tmp = opts.link.split('.')
      var table = $tmp[0]
      var fk = $tmp[1]

      return knex(table)
        .select(opts.columns)
        .where(fk, self.id)
        .then(function (records) {
          if (opts.model) {
            return _.map(records, function (row) {
              return self.model(opts.model).forge(row)
            })
          } else {
            return records
          }
        })
        .then(function (things) {
          if (opts.relationship === 'hasOne' && things.length === 1) {
            self._attributes.push(attribute)
            self[attribute] = things[0]
          } else if (opts.relationship === 'hasMany') {
            self[attribute] = things
          }

          return things
        })
    } else {
      return Promise.reject(new Error('Unknown related attribute: ' + kind + ':' + attribute))
    }
  }

  Thing.forge = function forge_thing (thingData) {
    var Thing = this
    return new Thing(thingData)
  }

  Thing.prototype.isNew = function is_thing_new () {
    return !this.id
  }

  Thing.exists = function does_thing_exist (id) {
    return knex(this.prototype.table)
      .select('id')
      .where('id', id)
      .then(function (records) {
        return records.length === 1
      })
  }

  Thing.prototype.save = function save_thing (opts) {
    var self = this
    opts = opts || {}

    if (_.isUndefined(opts.related)) {
      opts.related = _.keys(relatedMap[self.kind])
    } else if (!_.isArray(opts.related)) {
      console.warn('related save options is a weird type!')
    }

    return knex.transaction(function (trx) {
      var stuffToUpdate = _.pick(self, opts.only || _.difference(self._attributes, _.keys(relatedMap[self.kind])))
      stuffToUpdate.modified = new Date()

      // prepare related stuff to be saved
      if (opts.related) {
        opts.related = _.map(opts.related, function (attr) {
          var relatedOpts = relatedMap[self.kind][attr]
          return function saveRelatedThing () {
            if (relatedOpts.relationship === 'hasOne') {
              var $tmp = relatedOpts.link.split('.')
              var relatedTable = $tmp[0]
              var fk = $tmp[1]
              var saveStuff = _.pick(self[attr], relatedOpts.columns)
              saveStuff.modified = new Date()

              return knex(relatedTable)
                .transacting(trx)
                .where(fk, self.id)
                .update(saveStuff)
                .then(function (a) {
                  saveStuff = _.pick(saveStuff, relatedOpts.columns)
                  if (relatedOpts.model) {
                    saveStuff = self.model(relatedOpts.model).forge(saveStuff)
                  }

                  return {
                    attribute: attr,
                    data: saveStuff
                  }
                })
            } else {
              return Promise.resolve(true)
            }
          }
        })
      } else {
        opts.related = []
      }

      processHooks.call(self, 'before', 'save')

      var saveOpts = _.extend(opts, { transacting: trx })
      return (self.isNew() ? create.call(self, saveOpts) : update.call(self, saveOpts))
        .then(function () {
          return Promise.all(_.map(opts.related, function (execute) {
            return execute()
          }))
        })
        .then(function (relatedStuff) {
          _.each(relatedStuff, function (r) {
            self[r.attribute] = r.data
          })

          // actually wait on any async stuff
          return processHooks(self, 'after', 'save')
        })
        .then(function () {
          return self
        })
        .then(trx.commit)
        .catch(trx.rollback)
    })
  }

  function create (opts) {
    var table = modelOpts[this.kind].table
    var stuffToUpdate = _.pick(self, opts.only || _.difference(self._attributes, _.keys(relatedMap[self.kind])))

    var stmt = knex(table)

    if (opts.transacting) {
      stmt.transacting(opts.transacting)
    }

    return stmt.insert(stuffToUpdate)
      .returning('id')
      .then(function (ids) {
        self.id = ids[0]
        return self
      })
  }

  function updated (opts) {
    var table = modelOpts[this.kind].table
    var stuffToUpdate = _.pick(self, opts.only || _.difference(self._attributes, _.keys(relatedMap[self.kind])))
    delete stuffToUpdate.id

    var stmt = knex(table)

    if (opts.transacting) {
      stmt.transacting(opts.transacting)
    }

    return stmt.where('id', self.id)
      .update(stuffToUpdate)
  }

  /**
   * always called before sending to the world
   * @return {object}
   */
  Thing.prototype.toJSON = function () {
    return _.pick(this, _.difference(this._attributes, modelOpts[this.kind].hidden))
  }

  Thing.prototype.model = function get_model (name) {
    return models[name]
  }

  function processHooks (order, event) {
    var self = this
    var args = [].slice.call(arguments, 2)
    return Promise.all(_.map(hooks[self.kind][order][event]), function (fn) {
      return Promise.resolve(fn.apply(self, args))
    })
  }

  return Thing
}
/*
var thing = require('thing-orm')({
  knex: {},
  timestamps: ['created', 'modified'],
  table_prefix: ''
})

var User = thing.make('User', function () {
  this.table = 'users'
  
  this.before('save', function () {
  
  })

  this.after('save', function () {

  })
})

 */