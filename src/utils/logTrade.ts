import fs from 'fs';

export function logTrade(trade: any) {
  const historyFile = 'paper-trade-history.json';
  let history = [];
  if (fs.existsSync(historyFile)) {
    history = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
  }
  history.push(trade);
  fs.writeFileSync(historyFile, JSON.stringify(history));
}
