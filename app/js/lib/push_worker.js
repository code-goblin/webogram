'use strict';

console.log('[SW] Push worker started')


var port
var lastAliveTime = false
var pendingNotification = false
var muteUntil = false
var baseUrl
switch (location.hostname) {
  case 'localhost':
    baseUrl = 'http://localhost:8000/app/index.html#/im'
    break
  case 'zhukov.github.io':
    baseUrl = 'https://zhukov.github.io/webogram/#/im'
    break
  default:
  case 'web.telegram.org':
    baseUrl = 'https://' + location.hostname + '/#/im'
}

self.addEventListener('push', function(event) {
  var obj = event.data.json()
  console.log('[SW] push', obj)
  if (!obj.badge) {
    closeAllNotifications(obj, event)
  } else {
    fireNotification(obj, event)
  }
})

self.addEventListener('activate', function(event) {
  event.waitUntil(clients.claim())
})


self.addEventListener('message', function(event) {
  console.log('[SW] on message', event.data)
  port = event.ports[0] || event.source
  if (event.data.type == 'alive') {
    lastAliveTime = +(new Date())

    if (pendingNotification &&
        port &&
        'postMessage' in port) {
      port.postMessage(pendingNotification)
      pendingNotification = false
    }
  }
  if (event.data.type == 'notifications_clear') {
    closeAllNotifications(event.data, event)
  }
  if (event.data.baseUrl) {
    baseUrl = event.data.baseUrl
  }
})

function fireNotification(obj, event) {
  var nowTime = +(new Date())
  if (nowTime - lastAliveTime < 60000) {
    console.log('Supress notification because some instance is alive')
    return false
  }
  if (muteUntil && nowTime < muteUntil) {
    console.log('Supress notification because mute for ', (muteUntil - nowTime) / 60000, 'min')
    return false
  }

  var title = obj.title || 'Telegram'
  var body = obj.description || ''
  var icon = 'img/logo_share.png'
  var peerID

  if (obj.custom && obj.custom.channel_id) {
    peerID = -obj.custom.channel_id
  }
  else if (obj.custom && obj.custom.chat_id) {
    peerID = -obj.custom.chat_id
  }
  else {
    peerID = obj.custom && obj.custom.from_id || 0
  }
  obj.custom.peerID = peerID

  var notificationPromise = self.registration.showNotification(title, {
    body: body,
    icon: icon,
    tag: 'peer' + peerID,
    data: obj,
    actions: [
      {
        action: 'mute1d',
        title: 'Mute background alerts for 1 day'
      },
      {
        action: 'push_settings',
        title: 'Background alerts settings'
      }
    ]
  })

  var finalPromise = notificationPromise.then(function (event) {
    if (event && event.notification) {
      pushToNotifications(event.notification)
    }
  })

  event.waitUntil(finalPromise)

  return true
}


var notifications = []
function pushToNotifications(notification) {
  if (notifications.indexOf(notification) == -1) {
    notifications.push(notification)
    notification.onclose = onCloseNotification
  }
}

function onCloseNotification(event) {
  muteUntil = Math.max(muteUntil || 0, +(new Date()) + 600000) // 10 min
  removeFromNotifications(event.notification)
}

function removeFromNotifications(notification) {
  console.warn('on close', notification)
  var pos = notifications.indexOf(notification)
  if (pos != -1) {
    notifications.splice(pos, 1)
  }
}

function closeAllNotifications(obj, event) {
  for (var i = 0, len = notifications.length; i < len; i++) {
    try {
      notifications[i].close()
    } catch (e) {}
  }

  event.waitUntil(self.registration.getNotifications({}).then(function(notifications) {
    for (var i = 0, len = notifications.length; i < len; i++) {
      try {
        notifications[i].close()
      } catch (e) {}
    }
  }))

  notifications = []
}


self.addEventListener('notificationclick', function(event) {
  var notification = event.notification
  console.log('On notification click: ', notification.tag)
  notification.close()

  var action = event.action
  if (action == 'mute1d') {
    console.log('[SW] mute for 1d')
    muteUntil = +(new Date()) + 86400000
    IDBManager.setItem('mute_until', muteUntil.toString())
    return
  }

  event.waitUntil(clients.matchAll({
    type: 'window'
  }).then(function(clientList) {
    notification.data.action = action
    pendingNotification = {type: 'push_click', data: notification.data}
    for (var i = 0; i < clientList.length; i++) {
      var client = clientList[i]
      if ('focus' in client) {
        client.focus()
        ;(port || client).postMessage(pendingNotification)
        pendingNotification = false
        return
      }
    }
    if (clients.openWindow) {
      return clients.openWindow(baseUrl)
    }
  }))
})

self.addEventListener('notificationclose', onCloseNotification)




;(function () {
  var dbName = 'keyvalue'
  var dbStoreName = 'kvItems'
  var dbVersion = 2
  var openDbPromise
  var idbIsAvailable = self.indexedDB !== undefined &&
    self.IDBTransaction !== undefined

  function isAvailable () {
    return idbIsAvailable
  }

  function openDatabase () {
    if (openDbPromise) {
      return openDbPromise
    }

    return openDbPromise = new Promise(function (resolve, reject) {
      try {
        var request = indexedDB.open(dbName, dbVersion)
        var createObjectStore = function (db) {
          db.createObjectStore(dbStoreName)
        }
        if (!request) {
          throw new Exception()
        }
      } catch (error) {
        console.error('error opening db', error.message)
        idbIsAvailable = false
        return $q.reject(error)
      }

      var finished = false
      setTimeout(function () {
        if (!finished) {
          request.onerror({type: 'IDB_CREATE_TIMEOUT'})
        }
      }, 3000)

      request.onsuccess = function (event) {
        finished = true
        var db = request.result

        db.onerror = function (error) {
          idbIsAvailable = false
          console.error('Error creating/accessing IndexedDB database', error)
          reject(error)
        }

        resolve(db)
      }

      request.onerror = function (event) {
        finished = true
        idbIsAvailable = false
        console.error('Error creating/accessing IndexedDB database', event)
        reject(event)
      }

      request.onupgradeneeded = function (event) {
        finished = true
        console.warn('performing idb upgrade from', event.oldVersion, 'to', event.newVersion)
        var db = event.target.result
        if (event.oldVersion == 1) {
          db.deleteObjectStore(dbStoreName)
        }
        createObjectStore(db)
      }
    })
  }

  function setItem (key, value) {
    return openDatabase().then(function (db) {
      try {
        var objectStore = db.transaction([dbStoreName], IDBTransaction.READ_WRITE || 'readwrite').objectStore(dbStoreName)
        var request = objectStore.put(value, key)
      } catch (error) {
        idbIsAvailable = false
        return Promise.reject(error)
      }

      return new Promise(function(resolve, reject) {
        request.onsuccess = function (event) {
          resolve(value)
        }

        request.onerror = function (error) {
          reject(error)
        }
      })
    })
  }

  function getItem (key) {
    return openDatabase().then(function (db) {
      return new Promise(function(resolve, reject) {
        var objectStore = db.transaction([dbStoreName], IDBTransaction.READ || 'readonly').objectStore(dbStoreName)
        var request = objectStore.get(key)

        request.onsuccess = function (event) {
          var result = event.target.result
          if (result === undefined) {
            reject()
          } else {
            resolve(result)
          }
        }

        request.onerror = function (error) {
          reject(error)
        }
      })
      
    })
  }

  openDatabase()

  self.IDBManager = {
    name: 'IndexedDB',
    isAvailable: isAvailable,
    setItem: setItem,
    getItem: getItem
  }
})()



IDBManager.getItem('mute_until').then(function (newMuteUntil) {
  muteUntil = Math.max(muteUntil || 0, newMuteUntil || 0) || false
})