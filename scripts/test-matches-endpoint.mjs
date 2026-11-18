import { createSportsRouter } from '../src/server/core/routes/sports.js';
import express from 'express';

const app = express();
app.use('/api', createSportsRouter());

const server = app.listen(3388, async () => {
  try {
    const res = await fetch('http://127.0.0.1:3388/api/sports/matches');
    const data = await res.json();
    console.log('Matches count:', data.total);
    console.log('Sample matches (first 3):');
    data.matches.slice(0, 3).forEach(m => {
      console.log(`- [${m.league}] ${m.homeTeam.name} vs ${m.awayTeam.name} | Status: ${m.status} | Channels:`, m.channels);
    });
  } catch (err) {
    console.error('Error fetching matches:', err);
  } finally {
    server.close();
  }
});
