### thing-orm
just another object-relational mapping library, built on [knex](http://knexjs.org/), but less _backbone-y_

```javascript
var thing = require('thing-orm')({
  // knex configuration
})

var User = thing.make('User', function (knex) {
  this.table = 'users'
  
  this.static('authenticate', function auth_user(username, password) {
    return this.find({ username: username })
      .then(function (user) {
        return user.checkPassword(password)
      })
  })

  this.method('checkPassword', function check_password (passAttempt) {
    return new Promise((resolve, reject) => {
      if (somePasswordChecker(this.password, passAttempt)) {
        resolve()
      } else {
        reject()
      }
    })
  })
})

User.find({ id: userId })
  .then(function (user) {
    send(user)
  })
```
