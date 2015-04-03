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

  Thing.make = function make_new_thing (name, initialize) {
    var _static = {}
    var _proto = {
      table: name.toLowerCase() + 's'
    }

    var _opts = modelOpts[name] = {}
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

          _.forIn(_related, function (opts, attr) {
            var relatedData = _.pick(args[0], opts.columns)
            args[0] = _.omit(args[0], opts.columns)
            if (_.keys(relatedData).length > 0) {
              args[0][attr] = relatedData
            }
          })

          this.kind = name
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

    _.each(['table', 'hidden'], function (key) {
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

  /**
   * The table where this things stuff is located
   * @type {String}
   */
  Thing.prototype.table = ''

  Thing.prototype.defaultWhere = {}

  Thing.find = function findThing (where, opts) {
    var Thing = this.prototype.constructor
    var table = modelOpts[this.kind].table
    var self = this

    opts = opts || {}
    opts.select = opts.select || `${table}.*`

    if (_.isArray(opts.select)) {
      opts.select = _.map(opts.select, function (c) {
        return `${table}.${c}`
      })
    }

    _.extend(where, this.prototype.defaultWhere)

    var _where = {}
    _.forIn(where, function (val, key) {
      if (key.indexOf('.') === -1) {
        _where[`${table}.${key}`] = val
      } else {
        _where[key] = val
      }
    })

    var stmt = knex.select(opts.select)
      .from(table)
      .where(_where)

    if (_.isFunction(opts.beforeFind)) {
      _.each(hooks[this.kind].before.find, function (fn) {
        fn.call(self, stmt)
      })
    }

    _.forIn(relatedMap[Thing.kind], function (opts, attribute) {
      if (opts.join && opts.eager) {
        if (_.isString(opts.link)) {
          var $tmp = opts.link.split('.')
          var joinTable = $tmp[0]
          stmt[opts.join].call(stmt, joinTable, `${table}.id`, opts.link)
          stmt.select(_.map(opts.columns, function (c) {
            return `${joinTable}.${c}`
          }))
        } else if (_.isFunction(opts.link)) {
          stmt[opts.join].call(stmt, opts.link)
        } else {
          throw new Error('related data link is a weird type')
        }
      }
    })

    return stmt
      .then(function (rows) {
        if (rows.length === 1) {
          return new Thing(rows[0])
        } else {
          return null
        }
      })
      .then(function (thing) {
        var todo = []
        _.forIn(relatedMap[Thing.kind], function (opts, attribute) {
          if (opts.eager && !opts.join) {
            todo.push(attribute)
          }
        })

        if (thing && todo.length > 0) {
          return Promise.all(_.map(todo, function (a) {
            return thing.related(a)
          }))
            .then(function () {
              return thing
            })
        } else {
          return thing
        }
      })
  }

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
            var Model = self.model(opts.model)
            return _.map(records, function (row) {
              return new Model(row)
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
    var Thing = this.constructor
    return new Thing(thingData)
  }

  Thing._prefetch = function prefetch_thing () {
    return Promise.reject(new Error(`_prefetch for ${this.kind} not defined!`))
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

              if (self.isNew()) {
                saveStuff[fk] = self.id
                saveStuff.created = new Date()
                return knex(relatedTable)
                  .transacting(trx)
                  .insert(saveStuff)
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
              }
            } else {
              return Promise.resolve(true)
            }
          }
        })
      } else {
        opts.related = []
      }

      return knex(self.table)
        .transacting(trx)
        .where('id', self.id)
        .update(stuffToUpdate)
        .then(function () {
          return Promise.all(_.map(opts.related, function (execute) {
            return execute()
          }))
        })
        .then(function (relatedStuff) {
          _.each(relatedStuff, function (r) {
            self[r.attribute] = r.data
          })

          _.each(hooks[self.kind].after.save, function (fn) {
            fn.call(self)
          })

          return self
        })
        .then(trx.commit)
        .catch(trx.rollback)
    })
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