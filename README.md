### thing-orm [![js-standard-style](https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat)](https://github.com/feross/standard)
just another object-relational mapping library, built on [knex](http://knexjs.org/), but less _backbone-y_

```javascript
var thing = require('thing-orm')({
  // knex configuration
})

var User = thing.make('User', function (knex) {
  this.table = 'users'
  
  this.static('authenticate', function auth_user (username, password) {
    return this.find({ username: username })
      .then(function (user) {
        return user.checkPassword(password)
      })
  })

  this.method('checkPassword', function check_password (passAttempt) {
    return new Promise((resolve, reject) => {
      if (somePasswordChecker(this.password, passAttempt)) {
        resolve(this)
      } else {
        reject()
      }
    })
  })
})

User.authenticate('nkcmr', 'wrong-password')
  .then(function (user) {
    openSesame(user)
  })
  .catch(function () {
    goAway('now!')
  })
```

#### stability
this is still in a _"oo! this is nifty!"_ alpha stage. it works, but no tests and probably will bork up your stack.

#### goals
my dissatisfaction with most other ORMs in javascript is how they try to define everything about how an object should behave using pretty much just object literals

```javascript
...
myModel('User', {
  table: 'users',
  should: {
    do: function _thisAction () {
      // do stuff
    }
  },
  methods: {
    muhAction: function muhAction () {
      // do muh action
    }
  },
  static: {
    // ... you get the point!
  }
})
...
```

this is a very limiting way to define things that need to be versatile and configurable. so a primary goal of this package is to leverage a functional style to maintain flexible objects

```javascript
thing.make('User', function () {
  this.method('beFreeMyObjects', function () {
    // conjure an image of white doves taking flight...
  })

  if (globalConfig.allows('this.new.feature')) {
    this.method('coolFeature', function () {
      // do the coolest thing ever
    })
  } else {
    this.method('coolFeature', function () {
      return Promise.reject(new Error('not-just-yet-cool-feature'))
    })
  }
})
```

_see?!_ much better. i realize that object literals are still capable of being flexible, but the style doesn't lend itself to that. basically, if some newbie were to look at one versus the other, the latter is the more expressive and readable.

#### todo
- write base `Thing` api docs
