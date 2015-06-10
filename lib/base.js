'use strict'

var _ = require('lodash')
var ThingSchema = require('./schema')
var _util = require('./_util')
var knex

const SCHEMA_ACCESSOR_SYMBOL = Symbol('THING_SCHEMA')

function ThingError () {
  Error.apply(this, [].slice.call(arguments))
}
ThingError.prototype = _.create(Error.prototype, {
  constructor: ThingError
})

module.exports = function init (_config) {
  knex = require('knex')(_config)

  var hooks = {}
  var schemas = {}
  var models = {}
  var modelOpts = {}

  function Thing (rootData) {
    var self = this
    var schema = schemas[self.kind]

    schema.eachAttribute(function (attr) {
      if (_.isUndefined(_.get(rootData, attr.name))) {
        _.set(rootData, attr.name, attr.default())
      }

      if (_util.isPrimitiveType(attr.type())) {
        _.set(rootData, attr.name, _util.cast(_.get(rootData, attr.name), attr.type()))
      }

      if (attr.readonly()) {
        Object.defineProperty(self, attr.name, {
          value: _.get(rootData, attr.name)
        })
      } else if (attr.isVirtual()) {
        Object.defineProperty(self, attr.name, attr.getPropertyDefinition())
      }
    })

    this._attributes = _.keys(rootData)
    _.extend(this, rootData)
  }

  /**
   * Make a thing about it
   *
   * @access public
   * @param {string} name The models name, like "User" or "Post"
   * @param {function} initialize Build the model
   * @return {Thing} An object extended from the base Thing
   */
  function make_new_thing (name, initialize) {
    var Super, _static, _proto, _schema, _opts, _hook, initFn

    Super = this
    _static = {
      kind: name,
      super: Super
    }
    _proto = {
      kind: name,
      super: Super
    }

    _static[SCHEMA_ACCESSOR_SYMBOL] = _proto[SCHEMA_ACCESSOR_SYMBOL] = _schema = schemas[name] = new ThingSchema()
    _opts = modelOpts[name] = {
      table: name.toLowerCase() + 's'
    }
    _hook = hooks[name] = {
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

    function __ () {
      if (_.isFunction(initFn)) {
        initFn.apply(this, arguments)
      }
      Super.apply(this, arguments)
    }

    var assembler = {
      init: function (fn) {
        initFn = fn
      },
      constant: function (name, value) {
        Object.defineProperty(__, name, {
          value: _.isFunction(value) ? value.call(this) : value
        })
      },
      schema: function (descriptor) {
        _util.parseSchemaDescriptor(_schema, descriptor)
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
    _schema._compile()
    _.extend(__, Super, _static, {
      extend: make_new_thing
    })
    __.prototype = _.create(Super.prototype, _.extend(_proto, {
      constructor: __
    }))
    models[name] = __
    return __
  }
  Thing.make = make_new_thing

  const FIND_MODE_FIRST = 'first'
  const FIND_MODE_MANY = 'many'

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

    if (_.get(opts, 'lean') === true) {
      return Promise.resolve(mode === FIND_MODE_FIRST ? rows[0] : rows)
    }

    rows = _.map(rows, function (record) {
      return self.forge(record)
    })

    // @todo: Load eager related stuff
    return mode === FIND_MODE_FIRST ? rows[0] : rows
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
    var self = this
    var _opts = modelOpts[self.kind]
    var schema = schemas[self.kind]
    var stmt = knex(_opts.table)

    if (_.get(opts, 'select')) {
      stmt.select(opts.select)
    } else {
      stmt.select(_.map(schema._attributes, function (attr) {
        return attr.name
      }))
    }

    if (_.isFunction(where)) {
      where.call(stmt)
    } else if (_.isObject(where)) {
      for (var prop in where) {
        if ((/^\$where[a-z]+$/i).test(prop)) {
          var args = where[prop]
          if (!_.isArray(args)) {
            args = [args]
          }
          stmt[prop.slice(1)].apply(stmt, args)
        } else {
          stmt.where(prop, where[prop])
        }
      }
    }

    processHooks.call(this, 'before', 'find', stmt)

    if (mode === FIND_MODE_MANY) {
      if (_.get(opts, 'limit')) {
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

  function create_thing () {
    var self = this
    var schema = schemas[self.kind]
    return knex.transaction(function (trx) {
      return trx
         .insert(_.pick(self, _.map(schema._attributes, 'name')))
    })
  }

  function update_thing () {
    
  }

  Thing.prototype.save = function save_thing_wrapper () {
    return (this.isNew() ? create_thing : update_thing).call(this, arguments)
  }

  Thing.forge = function forge_thing (thingData) {
    var Thing = this
    return new Thing(thingData)
  }

  Thing.prototype.isNew = function is_thing_new () {
    return !this.id
  }

  Thing.exists = function does_thing_exist (id) {
    return knex(modelOpts[this.kind].table)
      .select('id')
      .where('id', id)
      .then(function (records) {
        return records.length === 1
      })
  }

  /**
   * always called before sending to the world
   * @return {object}
   */
  Thing.prototype.toJSON = function () {
    var out = {}
    var self = this
    schemas[this.kind].eachAttribute(function (attr) {
      if (!attr.hidden()) {
        out[attr.name] = self[attr.name]
      }
    })
    return out
  }

  function getModel (name) {
    var m = models[name]
    if (m) {
      return m
    } else {
      throw new Error(`Can not find model: '${name}'`)
    }
  }

  Thing.prototype.model = getModel
  Thing.model = getModel

  function processHooks (order, event) {
    var self = this
    var args = [].slice.call(arguments, 2)
    return Promise.all(_.map(hooks[self.kind][order][event]), function (fn) {
      return Promise.resolve(fn.apply(self, args))
    })
  }

  return Thing
}
