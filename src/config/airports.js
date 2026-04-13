export const REFRESH_MINUTES = 5;

export const REGIONS = [
  {
    id: "northeast",
    name: "Northeast",
    airports: [
      { airportId: "KBED", sortIndex: 1 },
      { airportId: "KMVY", sortIndex: 2 },
      { airportId: "KACK", sortIndex: 3 },
      { airportId: "KHPN", sortIndex: 4 },
      { airportId: "KJFK", sortIndex: 5 },
      { airportId: "KLGA", sortIndex: 6 },
      { airportId: "KEWR", sortIndex: 7 },
      { airportId: "KOXC", sortIndex: 8 }
    ]
  },
  {
    id: "florida_bahamas",
    name: "Florida / Bahamas",
    airports: [
      { airportId: "KSUA", sortIndex: 1 },
      { airportId: "KFXE", sortIndex: 2 },
      { airportId: "KFLL", sortIndex: 3 },
      { airportId: "MYAM", sortIndex: 4 },
      { airportId: "MYEH", sortIndex: 5 },
      { airportId: "MYNN", sortIndex: 6 }
    ]
  },
  {
    id: "caribbean",
    name: "Caribbean",
    airports: [
      { airportId: "TJSJ", sortIndex: 1 },
      { airportId: "TIST", sortIndex: 2 },
      { airportId: "TUPJ", sortIndex: 3 },
      { airportId: "TUPW", sortIndex: 4 },
      { airportId: "TQPF", sortIndex: 5 },
      { airportId: "TFFJ", sortIndex: 6 },
      { airportId: "TAPA", sortIndex: 7 }
    ]
  }
];

export function getAllAirportIds() {
  return REGIONS.flatMap(region => region.airports.map(a => a.airportId));
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