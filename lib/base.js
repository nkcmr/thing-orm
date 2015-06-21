'use strict'

var _ = require('lodash')
var ThingSchema = require('./schema')
var Promise = require('bluebird')
var _util = require('./_util')
var knex

const kind = Symbol('KIND')
const original_data = Symbol('ORIGINAL_DATA')
const MODIFIED_ATTRIBUTES = Symbol('MODIFIED_ATTRIBUTES')
const IS_BASE_THING = Symbol('IS_BASE_THING')
const FIND_MODE_FIRST = 'first'
const FIND_MODE_MANY = 'many'
const SAVE_MODE_CREATE = 'create'
const SAVE_MODE_UPDATE = 'update'

function ThingError () {
  Error.apply(this, arguments)
}
ThingError.prototype = _.create(Error.prototype, {
  constructor: ThingError
})

module.exports = function init (_config) {
  knex = require('knex')(_config)

  var hooks = {}
  var schemas = new Map()
  var models = new Map()
  var config = new Map()

  function Thing (rootData) {
    var self = this

    self[MODIFIED_ATTRIBUTES] = []
    self[original_data] = _.cloneDeep(rootData)

    Object.observe(self, function (changes) {
      _.each(changes, _.bind(processChangeEvent, self))
    })

    if (schemas.has(self[kind])) {
      schemas.get(self[kind]).eachAttribute(function (attr) {
        if (attr.type() === 'related') {
          self[attr.name] = _.bind(load_related_thing, self, attr)
          return
        }

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
    }

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
    var Super, _static, _proto, _opts, _hook, initFn

    Super = this
    _static = {
      super: Super
    }
    _proto = {
      super: Super
    }
    _opts = {
      primaryKey: 'id',
      table: `${name.toLowerCase()}s`
    }
    config.set(name, _opts)
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
      this[kind] = name
    }
    __[IS_BASE_THING] = false
    __[kind] = name

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
        var _schema = new ThingSchema()
        _util.parseSchemaDescriptor(_schema, descriptor)
        _schema._compile()
        schemas.set(name, _schema)
      },
      method: function (name, fn) {
        _proto[name] = fn
      },
      static: function (name, fn) {
        _static[name] = fn
      },
      before: function (hook, fn) {
        _.get(_hook, `before.${hook}`).push(fn)
      },
      after: function (hook, fn) {
        _.get(_hook, `after.${hook}`).push(fn)
      },
      behavior: function (fn) {
        fn.call(assembler, knex, __)
      }
    }

    _.each(['table', 'hidden', 'defaultFind', 'primaryKey'], function (key) {
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
    initialize.call(assembler, knex, __)
    _.extend(__, Super, _static, {
      extend: make_new_thing
    })
    __.prototype = _.create(Super.prototype, _.extend(_proto, {
      constructor: __
    }))
    models.set(name, __)
    return __
  }
  Thing.make = make_new_thing
  Thing[IS_BASE_THING] = true

  function load_related_thing (attribute) {
    var self = this
    var cfg = config.get(self[kind])
    if (_.has(attribute, 'model')) {
      var related_model = this.model(attribute.model)
      var find_mode = /many/i.test(attribute.relationshipType) ? FIND_MODE_MANY : FIND_MODE_FIRST
      var _opts = {}
      var fk = `${self[kind].toLowerCase()}_${cfg.primaryKey}`
      if (_.has(attribute.config(), 'foreign_key')) {
        fk = _.get(attribute.config(), 'foreign_key')
      }
      if (_.has(attribute.config(), 'related_conditions')) {
        _opts = _.get(attribute.config(), 'related_conditions')
      }
      _.merge(_opts, {
        $where: [fk, self[cfg.primaryKey]]
      })
      return find.call(related_model, find_mode, _opts)
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
  function query_complete (mode, opts, rows) {
    var self = this

    if (rows.length === 0) {
      return FIND_MODE_FIRST ? null : []
    }

    if (mode === FIND_MODE_FIRST) {
      rows = [rows[0]]
    }

    if (_.get(opts, 'lean') !== true) {
      rows = _.map(rows, function (record) {
        return self.forge(record)
      })
    }

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
    var table = config.get(self[kind]).table
    var stmt = knex(table)

    if (_.get(opts, 'select')) {
      stmt.select(opts.select)
    } else {
      if (schemas.has(self[kind])) {
        stmt.select(_.map(schemas.get(self[kind])._attributes, function (attr) {
          return `${table}.${attr.name}`
        }))
      } else {
        stmt.select(`${table}.*`)
      }
    }

    if (_.isFunction(where)) {
      where.call(stmt)
    } else if (_.isObject(where)) {
      for (var prop in where) {
        if (/^\$where([a-z]*)?$/i.test(prop)) {
          var args = where[prop]
          if (!_.isArray(_.get(args, '[0]'))) {
            args = [args]
          }
          for (var _args of args) {
            stmt[prop.slice(1)].apply(stmt, _args)
          }
        } else if (/^\$(limit|offset)$/.test(prop)) {
          stmt[prop.slice(1)].call(stmt, where[prop])
        } else {
          if (_.isArray(where[prop])) {
            stmt.whereIn(prop, where[prop])
          } else {
            stmt.where(prop, where[prop])
          }
        }
      }
    }

    if (_.get(opts, 'skip_before_find_hook') !== true) {
      processHooks.call(this, 'before', 'find', mode, where, opts)
    }

    if (mode === FIND_MODE_MANY) {
      if (_.get(opts, 'limit')) {
        stmt.limit(opts.limit)
      }
    } else if (mode === FIND_MODE_FIRST) {
      stmt.limit(1)
    }

    return stmt
      .then(function (rows) {
        return query_complete.call(self, mode, opts, rows)
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

  Thing.query = function wrap_custom_query (fn, opts) {
    var self = this
    fn.call(this)
      .then(function (rows) {
        return query_complete.call(self, FIND_MODE_MANY, opts, rows)
      })
  }

  Thing.prototype.isModified = function (attribute) {
    if (_.isUndefined(attribute)) {
      return this[MODIFIED_ATTRIBUTES].length > 0
    }
    return this[MODIFIED_ATTRIBUTES].indexOf(attribute) !== -1
  }

  /**
   * Get modified attributes.
   *
   * NOTE: Object.observe is slightly asynchronous, if the result of this needs
   * to be pretty darn accurate, wrap it in _.defer
   *
   * @return {array}
   */
  Thing.prototype.modifiedAttributes = function () {
    return this[MODIFIED_ATTRIBUTES]
  }

  function save_complete (mode, opts) {
    var self = this
    var Thing = self.constructor
    var pk = config.get(self[kind]).primaryKey
    return processHooks.call(this, 'after', 'save', opts)
      .then(function () {
        return find.call(Thing, FIND_MODE_FIRST, _.pick(self, pk))
      })
  }

  function get_save_thing (mode, opts) {
    var self = this
    var pk = config.get(self[kind]).primaryKey
    var saveThing = {}
    var saveAttributes = _.get(opts, 'attributes')
    if (schemas.has(self[kind])) {
      schemas.get(self[kind]).eachAttribute(function (attr) {
        if (attr.name !== pk) {
          if (_.isArray(saveAttributes) && !_.contains(saveAttributes, attr.name)) {
            return
          }
          _.set(saveThing, attr.name, _.get(self, attr.name))
        }
      })
    } else {
      return _.pick(self, saveAttributes)
    }
    return saveThing
  }

  function create_thing (opts) {
    var self = this
    var cfg = config.get(self[kind])
    return processHooks.call(self, 'before', 'save', opts)
      .then(function () {
        return (_.has(opts, 'transaction') ? knex.transaction(opts.transaction) : knex)
          .insert(get_save_thing.call(self, SAVE_MODE_CREATE, opts), cfg.primaryKey)
          .into(cfg.table)
      })
      .then(function (pk) {
        if (_.isArray(pk)) {
          pk = pk[0]
        }
        self[cfg.primaryKey] = pk
        return save_complete.call(self, SAVE_MODE_CREATE, opts)
      })
  }

  function update_thing (opts) {
    var self = this
    var cfg = config.get(self[kind])
    return processHooks.call(self, 'before', 'save', opts)
      .then(function () {
        return (_.has(opts, 'transaction') ? knex(cfg.table).transacting(opts.transaction) : knex(cfg.table))
          .where(cfg.primaryKey, self[cfg.primaryKey])
          .update(get_save_thing.call(self, SAVE_MODE_UPDATE, opts))
      })
      .then(function () {
        return save_complete.call(self, SAVE_MODE_UPDATE, opts)
      })
  }

  Thing.prototype.save = function save_thing_wrapper () {
    return (this.isNew() ? create_thing : update_thing).apply(this, arguments)
  }

  Thing.forge = function forge_thing (thingData) {
    var Thing = this
    return new Thing(thingData)
  }

  Thing.prototype.isNew = function is_thing_new () {
    return !_.has(this, config.get(this[kind]).primaryKey)
  }

  Thing.exists = function does_thing_exist (pkval) {
    var cfg = config.get(this[kind])
    return knex(cfg.table)
      .select(cfg.primaryKey)
      .where(cfg.primaryKey, pkval)
      .then(function (records) {
        return records.length === 1
      })
  }

  Thing.prototype.inspect = function () {
    var self = this
    var out = `${self[kind]}(${self[config.get(self[kind]).primaryKey]}) {\r\n`
    if (schemas.has(self[kind])) {
      schemas.get(self[kind]).eachAttribute(function (attr) {
        out += `\t${attr.name}: '${self[attr.name]}'\r\n`
      })
    } else {
      for (var attr in self._attributes) {
        out += `\t${attr}: '${self[attr.name]}'`
      }
    }
    out += '}\r\n'
    return out
  }

  /**
   * always called before sending to the world
   * @return {object}
   */
  Thing.prototype.toJSON = function () {
    var out = {}
    var self = this
    if (schemas.has(self[kind])) {
      schemas.get(this[kind]).eachAttribute(function (attr) {
        if (!attr.hidden()) {
          out[attr.name] = self[attr.name]
        }
      })
    } else {
      return _.pick(self, _.keys(self[original_data]))
    }
    return out
  }

  Thing.prototype.toObject = function () {
    
  }

  function get_model (name) {
    return models.get(name)
  }
  Thing.prototype.model = get_model
  Thing.model = get_model

  function processHooks (order, event) {
    var self = this
    var _hooks = hooks[self[kind]][order][event]
    if (_hooks.length === 0) {
      return Promise.resolve([])
    }
    var args = [].slice.call(arguments, 2)
    return Promise.map(_hooks, function (fn) {
      return fn.apply(self, args)
    }, { concurrency: 1 })
  }

  function processChangeEvent (changeEvent) {
    if (changeEvent.type === 'update' && this[MODIFIED_ATTRIBUTES].indexOf(changeEvent.name) === -1) {
      this[MODIFIED_ATTRIBUTES].push(changeEvent.name)
    }
  }

  return Thing
}
