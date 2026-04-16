export const REFRESH_MINUTES = 5;

export const REGIONS = [
{
  id: "northeast",
  name: "Northeast",
  airports: [
    { airportId: "KBED", sortIndex: 1, lat: 42.4699, lon: -71.2890, elevationFt: 133, hasMetar: true },
    { airportId: "KMVY", sortIndex: 2, lat: 41.3931, lon: -70.6143, elevationFt: 67, hasMetar: true },
    { airportId: "KACK", sortIndex: 3, lat: 41.2531, lon: -70.0602, elevationFt: 48, hasMetar: true },
    { airportId: "KHPN", sortIndex: 4, lat: 41.0670, lon: -73.7076, elevationFt: 439, hasMetar: true },
    { airportId: "KTEB", sortIndex: 5, lat: 40.8501, lon: -74.0608, elevationFt: 9, hasMetar: true },
    { airportId: "KOXC", sortIndex: 6, lat: 41.4786, lon: -73.1352, elevationFt: 726, hasMetar: true }
  ]
},
  {
    id: "florida_bahamas",
    name: "Florida / Bahamas",
    airports: [
      { airportId: "KSUA", sortIndex: 1, lat: 27.1817, lon: -80.2211, elevationFt: 16, hasMetar: true },
      { airportId: "KFXE", sortIndex: 2, lat: 26.1973, lon: -80.1707, elevationFt: 13, hasMetar: true },
      { airportId: "KFLL", sortIndex: 3, lat: 26.0726, lon: -80.1527, elevationFt: 9, hasMetar: true },
      { airportId: "MYAM", sortIndex: 4, lat: 26.5114, lon: -77.0835, elevationFt: 5, hasMetar: true },
      { airportId: "MYEH", sortIndex: 5, lat: 25.4749, lon: -76.6835, elevationFt: 7, hasMetar: false },
      { airportId: "MYNN", sortIndex: 6, lat: 25.0390, lon: -77.4662, elevationFt: 16, hasMetar: true }
    ]
  },
  {
    id: "caribbean",
    name: "Caribbean",
    airports: [
      { airportId: "TJSJ", sortIndex: 1, lat: 18.4394, lon: -66.0018, elevationFt: 9, hasMetar: true },
      { airportId: "TIST", sortIndex: 2, lat: 18.3373, lon: -64.9734, elevationFt: 23, hasMetar: true },
      { airportId: "TUPJ", sortIndex: 3, lat: 18.4448, lon: -64.5430, elevationFt: 15, hasMetar: true },
      { airportId: "TUPW", sortIndex: 4, lat: 18.7272, lon: -64.3297, elevationFt: 15, hasMetar: true },
      { airportId: "TQPF", sortIndex: 5, lat: 18.2048, lon: -63.0553, elevationFt: 127, hasMetar: true },
      { airportId: "TFFJ", sortIndex: 6, lat: 17.9044, lon: -62.8486, elevationFt: 48, hasMetar: true },
      { airportId: "TAPA", sortIndex: 7, lat: 17.1367, lon: -61.7927, elevationFt: 62, hasMetar: true }
    ]
  }
];

export function getAllAirportIds() {
  return REGIONS.flatMap(region => region.airports.map(a => a.airportId));
}

export function getAllAirportConfigs() {
  return REGIONS.flatMap(region =>
    region.airports.map(airport => ({
      regionId: region.id,
      regionName: region.name,
      ...airport
    }))
  );
}

export function getRegionByAirportId(airportId) {
  return REGIONS.find(region =>
    region.airports.some(a => a.airportId === airportId)
  ) || null;
}

export function getAirportConfig(airportId) {
  for (const region of REGIONS) {
    const airport = region.airports.find(a => a.airportId === airportId);
    if (airport) {
      return {
        regionId: region.id,
        regionName: region.name,
        ...airport
      };
    }
  }
  return null;
}