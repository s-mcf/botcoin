#! /usr/local/bin/node
var fs = require('fs');
var Steam = require('steam');
var SteamTrade = require('steam-trade');
var Coinbase = require('coinbase');
var config = require('./config')
var http = require('http');
var url = require('url');
var util = require('util');
var redis = require('redis');

var coin;
var rclient;

var inventory;
var keys;
var client;

var isReady = false;

var price = config.price; // key price in dollars per key

// Begin intialization

// Log in to Steam
console.log("Logging in to Steam...")
var steam = new Steam.SteamClient();
var steamTrade = new SteamTrade();

steam.logOn({
  accountName: config.steam.accountName,
  password: config.steam.password,
  shaSentryfile: fs.readFileSync('sentryfile'),
});

steam.on('sentry',function(sentryHash) {
  fs.writeFile('sentryfile',sentryHash,function(err) {
    if(err){
      console.log(err);
    } else {
      console.log('Saved sentry file hash as "sentryfile"');
    }
  });
});

// Log in to Coinbase
console.log("Logging in to Coinbase...");
coin = new Coinbase({APIKey: config.coinbase.APIKey});
coin.account.balance(function(err,data){
  console.log("Balance:    " + data.amount + " BTC");
  console.log("Key price: $" + price);
});

console.log("Connecting to Redis...");
rclient = redis.createClient();

// Callback server
console.log("Opening HTTP Server...");
http.createServer(function(request, response){
  var path = url.parse(request.url).pathname;
  if(path == '/' + config.secret){
    var raw = '';
    request.on('data', function(data){
      raw += data;
    });
    request.on('end', function () {
      util.log(raw);
      raw = JSON.parse(raw);
      if(raw['order']['transaction']['confirmations'] < 1 && raw['order']['transaction']['hash']){
        response.writeHead(402, {'Content-Type': 'text/plain' });
        response.end('Not confirmed');
      } else {
        response.writeHead(200, {'Content-Type': 'text/plain' });
        raw['order']['custom'] = JSON.parse(raw['order']['custom']);
        user = raw['order']['custom']['user'];
        rclient.incrby("keys:"+user, parseInt(raw['order']['custom']['amount']), function(){
          rclient.get("keys:"+user, function(err, obj) {
            send(user, "Your coins have been received! The bot now owes you " + obj + " keys. Send a trade request when you are ready.");
            response.end('Callback received');
          });
        });
      }
    });
  } else {
    console.warn("WARN " + "Got an unauthorized callback from " + request.connection.remoteAddress);
    response.statusCode = 401; // Unauthorized
    response.end();
  }
}).listen(8888);

steam.on('loggedOn', function() {
  steam.setPersonaState(Steam.EPersonaState.Busy);
  config.admins.forEach(function(friend){
    steam.addFriend(friend);
  });
});

steam.on('webSessionID', function(sessionID) {
  steamTrade.sessionID = sessionID;
  steam.webLogOn(function(cookies) {
    cookies.forEach(function(cookie) {
      steamTrade.setCookie(cookie);
    });
    // We're not ready to chat until we load the inventory
    ready();
  });
});

function ready() {
  if(!isReady) {
    // Handle offline friend requests
    for (friend in steam.friends) {
      if(steam.friends[friend] == Steam.EFriendRelationship.RequestRecipient) {
        makeFriend(friend, steam.friends[friend]);
      }
    }
    // Handle friend requests
    steam.on('friend', function(other, type){
      makeFriend(other, type);
    });
    // Handle trades
    steam.on('sessionStart', function(otherClient) {
      inventory = [];
      keys = [];
      client = otherClient;
  
      console.log('Log: ' + client + ' is trading');
      steamTrade.open(otherClient);
      steamTrade.loadInventory(440, 2, function(inv) {
        inventory = inv;
        keys = inv.filter(function(item) { return item.name == 'Mann Co. Supply Crate Key';});
        theirkeys = [];
        rclient.get("keys:"+client, function(err, obj) {
          if(obj) {
            theirkeys = keys.slice(0, obj);
          }
          steamTrade.addItems(theirkeys, function(){
            steamTrade.ready(function() {
              steamTrade.confirm();
            });
          });
        });
      });
    });
    steamTrade.on('end', function(result) {
      console.log('Log: ' + client + ' executed a ' + result + ' trade');
      if (result == 'complete') {
        rclient.set("keys:"+client, 0);
      }
    });
    steamTrade.on('ready', function() {
      steamTrade.ready(function() {
        steamTrade.confirm();
      });
    });
    // Handle messages
    steam.on('message', function(source, message, type, chatter) {
      if(!message){
        // The user typing triggers a blank message
        return;
      }
      console.log('From ' + source + ': ' + message);
      if (message == 'ping') {
        send(source, 'pong');
      } else {
        command = message.split(' ');
        switch (command[0]) {
          case "buy":
            buy(source, command);
            break;
          case "inventory":
            displayInv(source);
            break;
          case "help":
            help(source);
            break;
          case "price":
            setPrice(source, command);
            break;
          default:
            send(source, "I'm sorry, that's not a valid command.");
        }
      }
    });
    // Handle trade requests
    steam.on('tradeProposed', function(trade, source) {
      console.log('Log: ' + source + ' requests a trade');
      rclient.get("keys:"+source, function(err, obj) {
        if(obj > 0 || config.admins.indexOf(source) > -1){
          steam.respondToTrade(trade, true);
        }
        else {
          steam.respondToTrade(trade, false);
          send(source, "Either your coins have not arrived yet or you did not place an order.");
        }
      });
    });
    steam.setPersonaState(Steam.EPersonaState.LookingToTrade);
    isReady = true;
    console.log("Bot is ready now!");
    console.log("-----------------");
  } else {
    console.log("Log: we got a new set of cookies");
  }
}

// ---- Commands ---- //

function setPrice(source, command) {
  if(!(config.admins.indexOf(source) > -1) || isNaN(command[1])) {
    send(source, "The current key price is $" + price);
  } else {
    price = command[1];
    setPrice(source, []);
  }
}

// Implement 'inventory'
function displayInv(source) {
  steamTrade.loadInventory(440, 2, function(inv) {
    keys = inv.filter(function(item) { return item.name == 'Mann Co. Supply Crate Key';});
    send(source, "Currently there are " + keys.length + " keys in my inventory.");
  });
}

// Implement 'buy'
function buy(source, command) {
  steamTrade.loadInventory(440, 2, function(inv) {
    keys = inv.filter(function(item) { return item.name == 'Mann Co. Supply Crate Key';});
    if(command[1] > keys.length) {
      send(source, "Sorry, you're asking for more keys than I have!");
      return;
    } else if(parseInt(command[1]) < 1 || isNaN(parseInt(command[1])) || command[1] % 1 != 0) {
      send(source, "Please specify how many keys you want.");
      return;
    }
    if(!(config.admins.indexOf(source) > -1)) {
      order = price * command[1];
      var param = {
        "button": {
          "name": command[1] + " TF2 Keys",
          "price_string": order,
          "price_currency_iso": 'USD',
          "custom": JSON.stringify({'user': source, 'amount': command[1]}),
          "description": 'For user ' + source,
          "type": 'buy_now',
          "style": 'custom_large'
        }
      };
      coin.buttons.create(param, function (err, data) {
        if (err) {
          send(source, "An error occurred and my creator has been notified. Please try again.");
          console.error("ERR: " + source + ": " + err);
        } else {
          send(source, "Coinbase is ready to accept your payment, click here: https://coinbase.com/checkouts/"+data['button']['code']);
        }
      });
    } else {
      send(source, "Ah, I see you are an admin! Here, have some keys on me.");
      rclient.set("keys:"+source, parseInt(command[1]));
    }
  });
}

function help(source) {
  send(source, "Welcome to Botcoin!\
    Type 'buy x', where x is the number of keys you want to start the buying process. \
    You can also type 'inventory' to see how many keys I have, \
    and 'price' will tell you the current key price."
  );
}

// ---- Misc. ---- //
function makeFriend(other, type) {
  console.log("Log: " + other + ": status is now " + getKeyByValue(Steam.EFriendRelationship, type));
  if(type == Steam.EFriendRelationship.PendingInvitee)
  {
     steam.addFriend(other);
     send(other, "Welcome! Type help to begin!");
  }
}

function send(source, msg) {
  console.log('Sent ' + source + ": " + msg);
  steam.sendMessage(source, msg);
}

function getKeyByValue(set, value) {
   for(var k in set) {
      if(set.hasOwnProperty(k)) {
         if(set[k] == value) {
            return k;
         }
      }
   }
   return undefined;
}
