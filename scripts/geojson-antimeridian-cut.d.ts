declare module 'geojson-antimeridian-cut' {
  interface Geometry {
    type: string;
    coordinates: unknown;
  }
  const splitGeoJSON: (geometry: Geometry) => Geometry;
  export default splitGeoJSON;
}
