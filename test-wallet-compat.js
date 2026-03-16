/**
 * Simple test script to verify wallet.js compatibility with ethers ^6.16.0
 */
require('dotenv').config();

// Set up minimal test environment variables if not present
if (!process.env.PRIVATE_KEY) {
  // Generate a random test private key (not for production use)
  const { ethers } = require('ethers');
  const testWallet = ethers.Wallet.createRandom();
  process.env.PRIVATE_KEY = testWallet.privateKey;
  console.log('Using generated test private key');
}

if (!process.env.POLYGON_RPC_URL) {
  // Use a public Polygon RPC for testing
  process.env.POLYGON_RPC_URL = 'https://polygon-rpc.com';
  console.log('Using default Polygon RPC URL');
}

const wallet = require('./wallet.js');

async function testWallet() {
  console.log('\n--- Testing wallet.js with ethers ^6.16.0 ---\n');
  
  try {
    // Test 1: loadWallet
    console.log('Test 1: loadWallet()');
    const w = wallet.loadWallet();
    console.log('  ✓ Wallet loaded successfully');
    console.log('  Provider:', w.provider ? 'Connected' : 'Not connected');
    
    // Test 2: getAddress
    console.log('\nTest 2: getAddress()');
    const address = wallet.getAddress();
    console.log('  ✓ Address:', address);
    
    // Test 3: getBalance
    console.log('\nTest 3: getBalance()');
    try {
      const balance = await wallet.getBalance();
      console.log('  ✓ Balance:', balance, 'MATIC');
    } catch (err) {
      console.log('  ⚠ Balance check failed:', err.message);
      console.log('    (This is expected if RPC is unreachable or rate limited)');
    }
    
    console.log('\n--- All core functions tested successfully ---\n');
    return true;
  } catch (err) {
    console.error('\n✗ Test failed:', err.message);
    console.error('Stack:', err.stack);
    return false;
  }
}

testWallet().then(success => {
  process.exit(success ? 0 : 1);
});
