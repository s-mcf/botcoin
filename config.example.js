// Edit this file with the information for your accounts and rename to config.js

var config = {};

config.steam = {};
config.coinbase = {};

config.steam.accountName = ''; // Account name
config.steam.password = ''; // Password
config.coinbase.APIKey = ''; // Coinbase API key
config.price = 1.78; // key price in dollars
config.callback = ''; // The URL Coinbase should ping when it recieves a payment
config.admins = ['']; // Array of the ID64 numbers of the admins (as strings)

module.exports = config;
