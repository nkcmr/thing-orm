'use strict'

var _ = require('lodash')

function parseSchemaDescriptor (schema, descriptor) {
  if (_.isFunction(descriptor)) {
    descriptor.call(schema)
  } else if (_.isObject(descriptor)) {
    _.forIn(descriptor, function (v, k) {
      if (_.isFunction(v)) {
        v.call(schema.attribute(k))
      } else {
        schema.attribute(k, v)
      }
    })
  } else {
    throw new TypeError("Schema descriptor can be a function or an object. Got a '" + typeof descriptor + "'")
  }
}

function getAttributesOfType (schema, type) {
  return _.pick(schema, function (v, k) {
    return v.type === type
  })
}

function getRelated (schema) {
  return getAttributesOfType(schema, 'related')
}

function getVirtual (schema) {
  return getAttributesOfType(schema, 'virtual')
}

function getHidden (schema) {
  return _.keys(_.pick(schema, 'hidden'))
}

exports.parseSchemaDescriptor = parseSchemaDescriptor
exports.getAttributesOfType = getAttributesOfType
exports.getRelated = getRelated
exports.getVirtual = getVirtual
exports.getHidden = getHidden
