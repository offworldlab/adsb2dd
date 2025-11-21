import fetch from 'node-fetch';
import {lla2ecef, ft2m, norm} from './node/geometry.js';
import {calculateDopplerFromVelocity} from './node/doppler.js';

async function manualVerification() {
  console.log('='.repeat(70));
  console.log('Manual Doppler Verification Against Live ADS-B Data');
  console.log('='.repeat(70));

  const rxLat = -35.0;
  const rxLon = 138.7;
  const rxAlt = 50;
  const txLat = -35.0;
  const txLon = 138.6;
  const txAlt = 50;
  const fc = 204.64;

  const ecefRx = lla2ecef(rxLat, rxLon, rxAlt);
  const ecefTx = lla2ecef(txLat, txLon, txAlt);

  const adsb_url = 'http://localhost:5001/data/aircraft.json';
  console.log(`\nFetching ADS-B data from: ${adsb_url}`);

  const response = await fetch(adsb_url);
  const json = await response.json();

  if (!json.aircraft || json.aircraft.length === 0) {
    console.log('No aircraft found');
    return;
  }

  const aircraft = json.aircraft[0];
  console.log(`\nAircraft: ${aircraft.hex} (${aircraft.flight || 'N/A'})`);
  console.log(`  Position: lat=${aircraft.lat}°, lon=${aircraft.lon}°, alt=${aircraft.alt_geom} ft`);
  console.log(`  Velocity: gs=${aircraft.gs} knots, track=${aircraft.track}°, geom_rate=${aircraft.geom_rate || 'N/A'} ft/min`);

  const aircraft_ecef = lla2ecef(aircraft.lat, aircraft.lon, ft2m(aircraft.alt_geom));

  const dRxTar = norm([ecefRx.x - aircraft_ecef.x, ecefRx.y - aircraft_ecef.y, ecefRx.z - aircraft_ecef.z]);
  const dTxTar = norm([ecefTx.x - aircraft_ecef.x, ecefTx.y - aircraft_ecef.y, ecefTx.z - aircraft_ecef.z]);

  console.log(`\nGeometry:`);
  console.log(`  RX → Aircraft: ${(dRxTar/1000).toFixed(2)} km`);
  console.log(`  TX → Aircraft: ${(dTxTar/1000).toFixed(2)} km`);

  const doppler_manual = calculateDopplerFromVelocity(
    aircraft,
    aircraft_ecef,
    ecefRx,
    ecefTx,
    dRxTar,
    dTxTar,
    fc
  );

  console.log(`\n${'─'.repeat(70)}`);
  console.log('Manual Calculation (using doppler.js functions):');
  if (doppler_manual !== null) {
    console.log(`  Doppler: ${doppler_manual.toFixed(2)} Hz`);
  } else {
    console.log(`  Doppler: null (insufficient velocity data)`);
  }

  const api_url = `http://localhost:49155/api/dd?server=http://localhost:5001&rx=${rxLat},${rxLon},${rxAlt}&tx=${txLat},${txLon},${txAlt}&fc=${fc}`;
  console.log(`\n${'─'.repeat(70)}`);
  console.log('Fetching from adsb2dd API...');

  await new Promise(resolve => setTimeout(resolve, 2000));

  const api_response = await fetch(api_url);
  const api_data = await api_response.json();

  if (api_data.error) {
    console.log(`  Error: ${api_data.error}`);
  } else if (api_data[aircraft.hex]) {
    const api_doppler = parseFloat(api_data[aircraft.hex].doppler);
    const api_method = api_data[aircraft.hex].doppler_method;

    console.log(`API Response for ${aircraft.hex}:`);
    console.log(`  Doppler: ${api_doppler} Hz (method: ${api_method})`);

    if (doppler_manual !== null && api_method === 'velocity') {
      const diff = Math.abs(api_doppler - doppler_manual);
      const percent_diff = (diff / Math.abs(doppler_manual)) * 100;

      console.log(`\n${'─'.repeat(70)}`);
      console.log('Comparison:');
      console.log(`  Manual:  ${doppler_manual.toFixed(5)} Hz`);
      console.log(`  API:     ${api_doppler.toFixed(5)} Hz`);
      console.log(`  Diff:    ${diff.toFixed(5)} Hz (${percent_diff.toFixed(2)}%)`);

      if (percent_diff < 1) {
        console.log(`  ✓ PASS: Values match within 1%`);
      } else if (percent_diff < 5) {
        console.log(`  ⚠ WARN: Values differ by ${percent_diff.toFixed(2)}%`);
      } else {
        console.log(`  ✗ FAIL: Values differ significantly`);
      }
    }
  } else {
    console.log('  Aircraft not yet in API response (waiting for update cycle)');
  }

  console.log('\n' + '='.repeat(70));
}

manualVerification().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
