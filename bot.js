#! /usr/bin/node
var fs = require('fs');
var Steam = require('steam');
var SteamTrade = require('steam-trade');
var Coinbase = require('coinbase');
var doge = require('./node_modules/dogeapi.js/src/index.js') // I know this is dumb, but the DogeAPI.js module is awful and this appears to be the only way to import it
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
      if(raw['order']['transaction']['confirmations'] < config.confirmations && raw['order']['transaction']['hash']){
        response.writeHead(402, {'Content-Type': 'text/plain' });
        response.end('Not confirmed');
      } else {
        response.writeHead(200, {'Content-Type': 'text/plain' });
        raw['order']['custom'] = JSON.parse(raw['order']['custom']);
        user = raw['order']['custom']['user'];
        rclient.incrby("keys:"+user, parseInt(raw['order']['custom']['amount']), function(){
          rclient.incrby("reserved", parseInt(raw['order']['custom']['amount']));
          rclient.get("keys:"+user, function(err, obj) {
            send(user, "Your coins have been received! The bot now owes you " + obj + " keys. Send a trade request when you are ready.");
            rclient.incrby("sold", obj);
            checkInv(function(){});
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
        rclient.get("keys:"+client, function(err,obj){
          rclient.decrby("reserved", obj);
        });
        rclient.set("keys:"+client, 0);
        checkInv(function(){});
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
          case "mode":
            setMode(source, command);
            break;
          case "balance":
            sendBalance(source);
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
    checkInv(function(){});
  }
}

// ---- Commands ---- //

function sendBalance(source) {
  getBalance(source, function(balance, address){
    send(source, "Your current balance is " + balance + " DOGE");
  });
}

function getBalance(source, callback) {
  rclient.get("address:"+source, function(err, address) { // get deposit address for the user
    // make a new address if they don't have one
    if(!address) {
      doge.getNewAddress(null, function(err, newaddr){
        address = newaddr;
        rclient.set("address:"+source, address);
        callback(0, address);
      });
    } else {
      doge.getAddressReceived(address, null, function(err, balance) { // find the user's balance
        balance = parseInt(balance);
        if(balance) {
          rclient.get("spent:"+source, function(err, spent){
            if(spent) {
              balance -= spent;
            }
            callback(balance, address);
          });
        } else {
          callback(0, address);
        }
      });
    }
  });
}

function setPrice(source, command) {
  if(!(config.admins.indexOf(source) > -1) || isNaN(command[1])) {
    send(source, "The current key price is $" + price);
  } else {
    price = command[1];
    setPrice(source, []);
  }
}

function setMode(source,command) {
  if(command[1]) {
    mode = command[1].toLowerCase()
    if(mode == "bitcoin") {
      rclient.set("mode:"+source, mode);
      send(source, "Your buying mode has been set to Bitcoin");
    } else if (mode == "dogecoin") {
      rclient.set("mode:"+source, mode);
      send(source, "wow very mode change. such dogecoin");
    } else {
        send(source, "I'm sorry, that's not a valid mode. You can select Dogecoin or Bitcoin.");
    }
  } else {
    rclient.get("mode:"+source, function(err, obj){
      if(obj){
        send(source, "Your current buying mode is " + obj);
      } else {
        send(source, "Your current buying mode is bitcoin");
      }
    });
  }
}

// Implement 'inventory'
function displayInv(source) {
  checkInv(function(stock){
    send(source, "Currently there are " + stock + " keys in my inventory.");
  });
}

// Implement 'buy'
function buy(source, command) {
  steamTrade.loadInventory(440, 2, function(inv) {
    rclient.get("reserved", function(err, obj){
      stock = inv.filter(function(item) { return item.name == 'Mann Co. Supply Crate Key';}).length - obj;
      if(command[1] > stock) {
        send(source, "Sorry, you're asking for more keys than I have!");
        return;
      } else if(parseInt(command[1]) < 1 || isNaN(parseInt(command[1])) || command[1] % 1 != 0) {
        send(source, "Please specify how many keys you want.");
        return;
      }
      if(!(config.admins.indexOf(source) > -1)) {
        rclient.get("mode:" + source, function(err, rawmode){
          mode = rawmode.toLowerCase();
          if(mode == "bitcoin" || !mode) {
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
          } else if(mode == "dogecoin") {
            http.get("https://dogeapi.com/wow/?a=get_current_price", function(res) { // get latest price from DogeAPI
              data = '';
              res.on('data', function(chunk) {
                data  += chunk;
              });
              res.on('end', function() {
                dprice = parseInt(data);
                dprice = price / dprice; // And now we have the amount of DOGE required for one key. Whew!
                getBalance(source, function(balance, address){
                  if(balance < dprice * command[1]) {
                    // The total price of the order, minus their current balance, plus an extra 10 doge per key in case the price moves
                    // The 10 extra is not spent on keys and remains in the user's balance for future purchasesd
                    deposit = ((dprice * command[1]) - balance) + (10 * command[1]);
                    send(source, "Please deposit " + deposit +" DOGE to " + address + " , then trying buying again.");
                  } else {
                    rclient.incrby("spent:"+source, command[1] * dprice);
                    rclient.incrby("keys:"+source, command[1]);
                    rclient.incrby("sold:"+source, command[1]);
                    rclient.incrby("reserved", command[1]);
                    send(source, "Send a trade request when you are ready!");
                  }
                });
              });
            });
          }
        });
      } else {
        send(source, "Ah, I see you are an admin! Here, have some keys on me.");
        rclient.incrby("keys:"+source, parseInt(command[1]));
        rclient.incrby("reserved", parseInt(command[1]));
      }
    });
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
function checkInv(fn) {
  steamTrade.loadInventory(440, 2, function(inv) {
    rclient.get("reserved", function(err, obj){
      stock = inv.filter(function(item) { return item.name == 'Mann Co. Supply Crate Key';}).length - obj;
      if (stock < 1){
        console.warn("Log: out of keys");
        steam.setPersonaName("Botcoin - OUT OF STOCK");
        steam.setPersonaState(Steam.EPersonaState.Away);
      } else {
        steam.setPersonaName("Botcoin - " + stock + " in stock");
        steam.setPersonaState(Steam.EPersonaState.LookingToTrade);
      }
      fn(stock);
    });
  });
}

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
