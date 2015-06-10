'use strict'

var _ = require('lodash')
var moment = require('moment')
const TYPE_STRING = 'string'
const TYPE_NUMBER = 'number'
const TYPE_BOOLEAN = 'boolean'
const TYPE_DATE = 'date'
const TYPE_RELATED = 'related'
const TYPE_VIRTUAL = 'virtual'

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

function cast (value, type) {
  switch (type) {
    case TYPE_STRING:
      return String(value)
      break
    case TYPE_NUMBER:
      return Number(value)
      break
    case TYPE_BOOLEAN:
      return !!value
    case TYPE_DATE:
      if (value instanceof Date) {
        return value
      }
      return moment(value).toDate()
    default:
      throw new TypeError(`Unknown type: '${type}'`)
  }
}

function isPrimitiveType (type) {
  return _.contains([TYPE_STRING, TYPE_NUMBER, TYPE_BOOLEAN, TYPE_DATE], type)
}

exports.parseSchemaDescriptor = parseSchemaDescriptor
exports.cast = cast
exports.isPrimitiveType = isPrimitiveType
