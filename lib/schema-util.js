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
    throw new TypeError(`Schema descriptor can be a function or an object. Got a '${typeof descriptor}'`)
  }
}

function cast (schema, data) {
  
}

exports.parseSchemaDescriptor = parseSchemaDescriptor
exports.cast = cast
