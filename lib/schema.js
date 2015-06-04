'use strict'

var _ = require('lodash')
var schemaUtil = require('./schema-util')

const TYPE_STRING = 'string'
const TYPE_NUMBER = 'number'
const TYPE_BOOLEAN = 'boolean'
const TYPE_DATE = 'date'
const TYPE_RELATED = 'related'
const TYPE_VIRTUAL = 'virtual'

/**
 * Usable types for attributes
 *
 * @type {array}
 */
var types = [TYPE_STRING, TYPE_NUMBER, TYPE_BOOLEAN, TYPE_DATE, TYPE_RELATED, TYPE_VIRTUAL]

var attrPrivMap = new WeakMap()

function AttributeBuilder (name) {
  attrPrivMap.set(this, {
    name: name
  })
}

/**
 * Set an attributes type
 *
 * @param  {string} attrType One of those 'types' up there at the top of this file
 * @return {AttributeBuilder}
 */
AttributeBuilder.prototype.type = function (attrType) {
  if (_.isString(attrType) && _.contains(types, attrType)) {
    attrPrivMap.get(this).type = attrType
  }
  return this
}

/**
 * Define a getter function for a 'virtual' attribute
 *
 * @param {function} fn Getter function
 * @throws {TypeError} If Attribute has not been defined as 'virtual'
 */
AttributeBuilder.prototype.getter = function (fn) {
  if (attrPrivMap.get(this).type === TYPE_VIRTUAL) {
    attrPrivMap.get(this).getter = fn
  } else {
    throw new TypeError("Attribute must be 'virtual' to have a getter")
  }
  return this
}

/**
 * Define a setter function for a 'virtual' attribute
 *
 * @param {function} fn Setter function
 * @throws {TypeError} If attribute has not been defined as 'virtual'
 */
AttributeBuilder.prototype.setter = function (fn) {
  if (attrPrivMap.get(this).type !== TYPE_VIRTUAL) {
    throw new TypeError("Attribute must be 'virtual' to have a getter")
  }
  attrPrivMap.get(this).setter = fn
  return this
}

AttributeBuilder.prototype.link = function (link) {
  if (!attrPrivMap.get(this).type !== TYPE_RELATED) {
    throw new TypeError("Attribute must be a 'related' type to have a link")
  }
  attrPrivMap.get(this).link = link
  return this
}

AttributeBuilder.prototype.schema = function (descriptor) {
  if (!attrPrivMap.get(this).type !== TYPE_RELATED) {
    throw new TypeError("Attribute must be a 'related' type to have a schema")
  }
  var subSchema = new ThingSchema()
  schemaUtil.parseSchemaDescriptor(subSchema, descriptor)
  attrPrivMap.get(this).schema = subSchema._compile()
  return this
}

AttributeBuilder.prototype.relationship = function (r) {
  if (!attrPrivMap.get(this).type !== TYPE_RELATED) {
    throw new TypeError("Attribute must be a 'related' type to have a schema")
  }
  var name = attrPrivMap(this).name
  if (!_.contains(['hasOne', 'hasMany'], r)) {
    throw new Error(`Attribute '${name}' has an invalid relationship: '${r}'`)
  }
  attrPrivMap(this).relationship = r
  return this
}

AttributeBuilder.prototype.hidden = function (is) {
  if (!_.isBoolean(is)) {
    throw new TypeError("Attribute 'hidden' setting should be a boolean. Got a '" + typeof is + "'")
  }

  attrPrivMap.get(this).hidden = is
  return this
}

AttributeBuilder.prototype.default = function (defaultValue) {
  attrPrivMap.get(this).defaultValue = defaultValue
  return this
}

/*
this
  .attribute('settings', 'related')
  .link('user_settings.user_id')
  .schema(function () {
  })
 */

function compileAttribute (attribute) {
  var attr = attrPrivMap.get(attribute)

  if (attr.type === TYPE_RELATED) {
    if (_.isUndefined(attr.relationship)) {
      throw new Error("Attributes of the 'related' type must define a relationship")
    } else if (attr.relationship === 'hasOne') {
      if (!_.isBoolean(attr.eager)) {
        attr.eager = true
      }
      if (!attr.join) {
        attr.join = 'innerJoin'
      }
    }
    if (attr.relationship === 'hasOne' && !_.isBoolean(attr.eager)) {
      attr.eager = true
    }
  }

  delete attr.name
  return attr
}

function ThingSchema () {
  this._attributes = []
}

ThingSchema.prototype.attribute = function (name, description) {
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

ThingSchema.prototype._compile = function () {
  var schema = {}
  _.each(this._attributes, function (attribute) {
    schema[attrPrivMap.get(attribute).name] = compileAttribute(attribute)
  })
  return schema
}

module.exports = ThingSchema
