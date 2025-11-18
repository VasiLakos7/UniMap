export const MaieutikiNodes = {
  BS_1: { lat: 40.657347, lng: 22.801856 },
  BS_2: { lat: 40.657376, lng: 22.802575 },
  PATH_1: { lat: 40.657091, lng: 22.802580 },
  FOUNTAIN_1: { lat: 40.657095, lng: 22.803197 },
  FOUNTAIN_2: { lat: 40.657083, lng: 22.803540 },
  ALIGN_1: { lat: 40.657197, lng: 22.803546 },
  MAIN_BEFORE_MAI: { lat: 40.657160, lng: 22.805396 },
  MAI_ROAD: { lat: 40.657453, lng: 22.805369 },
  MAI_ENTRANCE: { lat: 40.657445, lng: 22.805300 },
};

export const MaieutikiSegments = [
  { from: "BS_1", to: "BS_2" },
  { from: "BS_2", to: "PATH_1" },
  { from: "PATH_1", to: "FOUNTAIN_1" },
  { from: "FOUNTAIN_1", to: "FOUNTAIN_2" },
  { from: "FOUNTAIN_2", to: "ALIGN_1" },
  { from: "ALIGN_1", to: "MAIN_BEFORE_MAI" },
  { from: "MAIN_BEFORE_MAI", to: "MAI_ROAD" },
  { from: "MAI_ROAD", to: "MAI_ENTRANCE" },
];
