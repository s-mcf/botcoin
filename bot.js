#! /usr/local/bin/node
console.log("Botcoin dev build");
var fs = require('fs');
var Steam = require('steam');
var Coinbase = require('coinbase');
var config = require('./config')
var http = require('http');
var url = require('url');
var coin;

var price = config.price; // key price in dollars per key
var btcprice = 1;         // key price in BTC per key
var rate = 1;             // Bitcoin price in dollars per BTC
var uam = {};             // User/address map. Maps addresses to users and whether or not they have paid

console.log(config.admins);

// Begin intialization
// Log in to Steam
console.log("Logging in to Steam...")
var bot = new Steam.SteamClient();

bot.logOn({
  accountName: config.steam.accountName,
  password: config.steam.password,
  shaSentryfile: fs.readFileSync('sentryfile'),
});

// Log in to Coinbase
console.log("Logging in to Coinbase...");
coin = new Coinbase({APIKey: config.coinbase.APIKey});
coin.account.balance(function(err,data){
  console.log("Balance:        " + data.amount + " BTC");
});

// Get exchange rates
coin.currencies.exchangeRates(function(err,data){
  rate = data.btc_to_usd;
  btcprice = Math.round((price / rate) * 100000) / 100000
  console.log("Exchange rate:  " + rate + "  $/BTC");
  console.log("Key price:      $" + price);
  console.log("Key price:      " + btcprice + " BTC");
});

// Callback server
console.log("Opening HTTP Server...");
http.createServer(function(request, response){
  var path = url.parse(request.url).pathname;
  var raw = '';
  console.log('Received a POST callback');
  request.on('data', function(data){
    raw += data;
  });
  response.writeHead(200, {'Content-Type': 'text/plain' });
  request.on('end', function () {
    console.log(raw);
    raw = JSON.parse(raw);
    bot.sendMessage(uam[raw['address']], "Your coins have been received! Send a trade request when you are ready.");
  });
  response.end('Callback received');
}).listen(8888);

bot.on('loggedOn', function() {
  bot.setPersonaState(Steam.EPersonaState.Online);
});

bot.on('message', function(source, message, type, chatter) {
  if(!message){
    return;
  }
  // respond to both chat room and private messages
  console.log('Received message from ' + source + ': ' + message);
  if (message == 'ping') {
    bot.sendMessage(source, 'pong', Steam.EChatEntryType.ChatMsg); // ChatMsg by default
    bot.trade(source);
  } else {
    command = message.split(' ');
    switch (command[0]) {
      case "buy":
        buy(source, command);
        break;
      default:
        bot.sendMessage(source, "I'm sorry, that's not a valid command.");
    }
  }
});

function buy(source, command) {
  bot.sendMessage(source, "Buying " + command[1] + " " + command[2]);
  if(!(config.admins.indexOf(source) > -1)) {
    order = Math.round((btcprice * command[1]) * 100000) / 100000;
    var param = {
              "button": {
                "name": "TF2 Keys",
                "price_string": order.toString(),
                "price_currency_iso": 'BTC',
                "custom": source,
                "description": '',
                "type": 'buy_now',
                "style": 'custom_large'
              }
            };
  coin.buttons.create(param, function (err, data) {
    if (err) throw err;
    console.log(data);
  });
  } else {
    bot.sendMessage(source, "Ah, I see you are an admin! Here, have some keys on me.");
    uam[source] = [source, true];
  }
}

bot.on('tradeProposed', function(trade, source) {
  console.log('Trade request');
  if(getKeyByValue(uam, [source, true])){
    bot.respondToTrade(trade, true);
    bot.sendMessage(source, "Traded",Steam.EChatEntryType.ChatMsg);
  }
  else {
    bot.respondToTrade(trade, false);
    bot.sendMessage(source, "Either your coins have not arrived yet or you did not place an order.");
  }
});

bot.on('sentry',function(sentryHash) {
  fs.writeFile('sentryfile',sentryHash,function(err) {
    if(err){
      console.log(err);
    } else {
      console.log('Saved sentry file hash as "sentryfile"');
    }
  });
});

function getKeyByValue(array, value) {
    for( var prop in array ) {
        if( this.hasOwnProperty( prop ) ) {
             if( array[ prop ] === value )
                 return prop;
        }
    }
}
