#! /usr/local/bin/node
console.log("Botcoin dev build");
var fs = require('fs');
var Steam = require('steam');
var Coinbase = require('coinbase');
var config = require('./config')
var coin;

var price = config.price; // key price in dollars per key
var btcprice = 1;         // key price in BTC per key
var rate = 1;             // Bitcoin price in dollars per BTC

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

function ConnectCoinbase() {
  console.log("Logging in to Coinbase...");
  coin = new Coinbase({APIKey: config.coinbase.APIKey});
  coin.account.balance(function(err,data){
    console.log("Balance:        " + data.amount + " BTC");
  });
  coin.currencies.exchangeRates(function(err,data){
    rate = data.btc_to_usd;
    btcprice = Math.round((price / rate) * 100000) / 100000
    console.log("Exchange rate:  " + rate + "  $/BTC");
    console.log("Key price:      $" + price);
    console.log("Key price:      " + btcprice + " BTC");
  });
}

bot.on('message', function(source, message, type, chatter) {
  if(!message){
    return;
  }
  // respond to both chat room and private messages
  console.log('Received message: ' + message);
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
  order = Math.round((btcprice * command[1]) * 100000) / 100000;
  address = "1test";
  bot.sendMessage(source, "Please send " + order + " BTC to " + address);
}

bot.on('tradeProposed', function(trade, source) {
  console.log('Trade request');
  bot.respondToTrade(trade, true);
  bot.sendMessage(source, "Traded",Steam.EChatEntryType.ChatMsg);
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
