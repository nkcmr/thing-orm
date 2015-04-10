'use strict'

var _ = require('lodash')

/**
 * Usable types for attributes
 *
 * @type {array}
 */
var types = ['string', 'number', 'boolean', 'date', 'related', 'virtual']

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
  if (attrPrivMap.get(this).type === 'virtual') {
    attrPrivMap.get(this).getter = fn
  } else {
    throw new TypeError("Attribute must be 'virtual' to have a getter")
  }
}

/**
 * Define a setter function for a 'virtual' attribute
 *
 * @param {function} fn Setter function
 * @throws {TypeError} If attribute has not been defined as 'virtual'
 */
AttributeBuilder.prototype.setter = function (fn) {
  if (attrPrivMap.get(this).type === 'virtual') {
    attrPrivMap.get(this).setter = fn
  } else {
    throw new TypeError("Attribute must be 'virtual' to have a getter")
  }
}

function compileAttribute (attribute) {
  var priv = attrPrivMap.get(attribute)
  delete priv.name
  return priv
}

function ThingSchema () {
  this._attributes = []
}

ThingSchema.prototype.attribute = function (name, description) {
  var attrBld = new AttributeBuilder(name)

  if (_.isString(description)) {
    attrBld.type(description)
  } else if (_.isObject(description)) {
    _.forIn(description, function (v, k) {
      switch (k) {
        case 'type':
        case 'getter':
        case 'setter':
          attrBld[k](v)
          break
      }
    })
  }

  this._attributes.push(attrBld)

  return attrBld
}

ThingSchema.prototype._compile = function () {
  var schema = {}
  _.each(this._attributes, function (attribute) {
    schema[attribute._name] = compileAttribute(attribute)
  })
  return schema
}

module.exports = ThingSchema
