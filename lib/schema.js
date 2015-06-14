'use strict'

var _ = require('lodash')
var _util = require('./_util')

const TYPE_STRING = 'string'
const TYPE_NUMBER = 'number'
const TYPE_BOOLEAN = 'boolean'
const TYPE_DATE = 'date'
const TYPE_RELATED = 'related'
const TYPE_VIRTUAL = 'virtual'
const ATTRIBUTE_ACCESSOR_SYMBOL = Symbol('ATTRIBUTE_ACCESSOR_SYMBOL')

function SchemaError () {
  Error.apply(this, arguments)
}
SchemaError.prototype = _.create(Error.prototype, {
  constructor: SchemaError
})

/**
 * Usable types for attributes
 *
 * @type {array}
 */
var types = [TYPE_STRING, TYPE_NUMBER, TYPE_BOOLEAN, TYPE_DATE, TYPE_RELATED, TYPE_VIRTUAL]

function AttributeBuilder (name) {

  this.name = name

  var attribute = {
    name: name,
    type: 'string',
    hidden: (name.charAt(0) === '_'),
    readonly: false
  }

  function initRelation (relationshipType, model, options) {
    this.type(TYPE_RELATED)
    this.relationshipType(relationshipType)
    this.model(model)
    return this
  }

  this.hasOne = _.bind(initRelation, this, 'hasOne')
  this.hasMany = _.bind(initRelation, this, 'hasMany')
  this.belongsTo = _.bind(initRelation, this, 'belongsTo')
  this.belongsToMany = _.bind(initRelation, this, 'belongsToMany')

  /**
   * Set an attributes type
   *
   * @access privelaged
   * @param  {string} attrType One of those 'types' up there at the top of this file
   * @return {AttributeBuilder}
   */
  this.type = function set_attribute_type (attrType) {
    if (_.isUndefined(attrType)) {
      return attribute.type
    }
    if (_.isString(attrType) && _.contains(types, attrType)) {
      attribute.type = attrType
    }
    return this
  }

  this.relationshipType = function set_relationship_type (relationshipType) {
    if (_.isUndefined(relationshipType)) {
      return attribute.relationshipType
    }
    attribute.relationshipType = relationshipType
    return this
  }

  this.model = function set_related_model (model) {
    if (_.isUndefined(model)) {
      return attribute.model
    }
    attribute.model = model
    return this
  }

  this.readonly = function set_readonly_flag (is) {
    if (_.isUndefined(is)) {
      return attribute.readonly
    }
    attribute.readonly = !!is
    return this
  }

  /**
   * Define a getter function for a 'virtual' attribute
   *
   * @access privelaged
   * @param {function} fn Getter function
   * @throws {TypeError} If Attribute has not been defined as 'virtual'
   */
  this.getter = function set_attribute_virtual_getter (fn) {
    if (_.isUndefined(fn)) {
      return attribute.getter
    }
    if (attribute.type !== TYPE_VIRTUAL) {
      throw new TypeError("Attribute must be 'virtual' to have a getter")
    }
    if (!_.isFunction(fn)) {
      throw new TypeError('getter must be a function')
    }
    attribute.getter = fn
    return this
  }

  /**
   * Define a setter function for a 'virtual' attribute
   *
   * @param {function} fn Setter function
   * @throws {TypeError} If attribute has not been defined as 'virtual'
   */
  this.setter = function set_attribute_virtual_setter (fn) {
    if (_.isUndefined(fn)) {
      return attribute.setter
    }
    if (attribute.type !== TYPE_VIRTUAL) {
      throw new TypeError("Attribute must be 'virtual' to have a getter")
    }
    if (!_.isFunction(fn)) {
      throw new TypeError('setter must be a function')
    }
    attribute.setter = fn
    return this
  }

  this.getPropertyDefinition = function get_property_definition () {
    var def = {}
    def.enumerable = true
    if (attribute.getter) {
      def.get = attribute.getter
    }
    if (attribute.setter) {
      def.set = attribute.setter
    }
    return def
  }

  this.link = function set_attribute_related_link (link) {
    if (attribute.type !== TYPE_RELATED) {
      throw new TypeError("Attribute must be a 'related' type to have a link")
    }
    attribute.link = link
    return this
  }

  this.schema = function set_attribute_related_schema (descriptor) {
    if (attribute.type !== TYPE_RELATED) {
      throw new TypeError("Attribute must be a 'related' type to have a schema")
    }
    var subSchema = new ThingSchema()
    _util.parseSchemaDescriptor(subSchema, descriptor)
    subSchema._compile()
    attribute.schema = subSchema
    return this
  }

  this.relationship = function set_attribute_related_relationship (r) {
    if (_.isUndefined(r)) {
      return attribute.relationship
    }
    if (attribute.type !== TYPE_RELATED) {
      throw new TypeError("Attribute must be a 'related' type to have a schema")
    }
    if (!_.contains(['hasOne', 'hasMany'], r)) {
      throw new SchemaError(`Attribute '${attribute.name}' has an invalid relationship: '${r}'`)
    }
    attribute.relationship = r
    return this
  }

  this.hidden = function set_attribute_visibility (is) {
    if (_.isUndefined(is)) {
      return attribute.hidden
    }
    attribute.hidden = !!is
    return this
  }

  this.default = function set_attribute_default_value (defaultValue) {
    if (_.isUndefined(defaultValue)) {
      if (_.isFunction(attribute.defaultValue)) {
        return attribute.defaultValue.call(this)
      } else {
        return attribute.defaultValue || null
      }
    }
    attribute.defaultValue = defaultValue
    return this
  }

  this.isString = function () {
    return attribute.type === TYPE_STRING
  }

  this.isNumber = function () {
    return attribute.type === TYPE_NUMBER
  }

  this.isBoolean = function () {
    return attribute.type === TYPE_BOOLEAN
  }

  this.isDate = function () {
    return attribute.type === TYPE_DATE
  }

  this.isRelated = function () {
    return attribute.type === TYPE_RELATED
  }

  this.isVirtual = function () {
    return attribute.type === TYPE_VIRTUAL
  }

  this[ATTRIBUTE_ACCESSOR_SYMBOL] = attribute
}

function checkAttribute (attribute) {
  var attr = attribute[ATTRIBUTE_ACCESSOR_SYMBOL]
  if (attr.type === TYPE_VIRTUAL) {
    if (!attr.getter && !attr.setter) {
      throw new SchemaError('virtual attribute does not have a getter or setter')
    }
  }
}

function ThingSchema () {
  this._attributes = []
  this._built = false
}

ThingSchema.prototype.attribute = function (name, description) {
  if (!description) {
    let attribute = _.find(this._attributes, function (attr) {
      return attr[ATTRIBUTE_ACCESSOR_SYMBOL].name === name
    })
    if (_.isUndefined(attribute)) {
      throw new Error(`Unknown attribute: '${name}'`)
    }
    return attribute
  }
  if (this._built !== false) {
    throw new SchemaError('Cannot modify schema after bootstrap')
  }
  var attrBld = new AttributeBuilder(name)

  if (_.isString(description)) {
    attrBld.type(description)
  } else if (_.isObject(description)) {
    _.forIn(description, function (args, method) {
      if (!_.isArray(args)) {
        args = [args]
      }
      attrBld[method].apply(attrBld, args)
    })
  } else if (_.isFunction(description)) {
    description.call(attrBld)
  }

  this._attributes.push(attrBld)

  return attrBld
}

ThingSchema.prototype.related = function () {
  if (this._built !== true) {
    throw new SchemaError('Cannot read schema before bootstrap is complete')
  }

  return _(this._attributes)
    .filter(function (attr) {
      return attr[ATTRIBUTE_ACCESSOR_SYMBOL].type === TYPE_RELATED
    })
    .map('name')
    .value()
}

ThingSchema.prototype.virtual = function () {
  if (this._built !== true) {
    throw new SchemaError('Cannot read schema before bootstrap is complete')
  }

  return _(this._attributes)
    .filter(function (attr) {
      return attr[ATTRIBUTE_ACCESSOR_SYMBOL].type === TYPE_VIRTUAL
    })
    .map('name')
    .value()
}

ThingSchema.prototype.eachAttribute = function (fn) {
  _.each(this._attributes, fn, this)
}

ThingSchema.prototype._compile = function () {
  _.each(this._attributes, checkAttribute)
  this._built = true
}

ThingSchema.prototype[Symbol.iterator] = function * () {
  for (var i = 0; i < this._attributes.length; i++) {
    yield this._attributes[i]
  }
}

module.exports = ThingSchema
