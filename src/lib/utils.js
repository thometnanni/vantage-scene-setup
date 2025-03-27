import JSZip from "jszip";
import osmtogeojson from "osmtogeojson";
import * as turf from "@turf/turf";

import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { generateMergedBuildingsGeometry } from "./buildingFactory.js";

export function calculateBoundsFromLatLngs(latlngs) {
  const latLngBounds = L.latLngBounds(latlngs);
  return [latLngBounds.getSouthWest(), latLngBounds.getNorthEast()];
}

export async function fetchData(
  latlngs,
  osmGeoJSONStore,
  setSouthWest,
  setNorthEast
) {
  if (!latlngs) {
    console.error("fetchData: latlngs is undefined or null.");
    return;
  }

  if (latlngs.center && latlngs.radius) {
    if (!latlngs.center.lat || !latlngs.center.lng) {
      console.error("fetchData: latlngs.center is missing lat or lng.");
      return;
    }
  } else if (!Array.isArray(latlngs) || latlngs.length === 0) {
    console.error("fetchData: latlngs is not a valid polygon array.");
    return;
  }

  let southWest, northEast;

  if (latlngs.center && latlngs.radius) {
    const center = latlngs.center;

    const radiusInLatitudeDegrees = latlngs.radius / 111320;
    const radiusInLongitudeDegrees =
      latlngs.radius / (111320 * Math.cos((center.lat * Math.PI) / 180));

    southWest = {
      lat: center.lat - radiusInLatitudeDegrees,
      lng: center.lng - radiusInLongitudeDegrees,
    };
    northEast = {
      lat: center.lat + radiusInLatitudeDegrees,
      lng: center.lng + radiusInLongitudeDegrees,
    };
  } else {
    const latLngBounds = L.latLngBounds(latlngs);
    southWest = latLngBounds.getSouthWest();
    northEast = latLngBounds.getNorthEast();
  }

  setSouthWest(southWest);
  setNorthEast(northEast);

  try {
    const overpassUrl = `https://overpass-api.de/api/interpreter`;
    const query = `
    [out:json];
    (

    way["building"](${southWest.lat},${southWest.lng},${northEast.lat},${northEast.lng});
    relation["building"](${southWest.lat},${southWest.lng},${northEast.lat},${northEast.lng});
    
    way["building:part"](${southWest.lat},${southWest.lng},${northEast.lat},${northEast.lng});
    relation["building:part"](${southWest.lat},${southWest.lng},${northEast.lat},${northEast.lng});
    
    way["roof:shape"](${southWest.lat},${southWest.lng},${northEast.lat},${northEast.lng});
    relation["roof:shape"](${southWest.lat},${southWest.lng},${northEast.lat},${northEast.lng});
    way["roof:height"](${southWest.lat},${southWest.lng},${northEast.lat},${northEast.lng});
    relation["roof:height"](${southWest.lat},${southWest.lng},${northEast.lat},${northEast.lng});
    way["roof:colour"](${southWest.lat},${southWest.lng},${northEast.lat},${northEast.lng});
    relation["roof:colour"](${southWest.lat},${southWest.lng},${northEast.lat},${northEast.lng});

    );
    out body;
    >;
    out skel qt;
  `;

    const response = await fetch(overpassUrl, {
      method: "POST",
      body: query,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    if (!response.ok) return;

    const rawData = await response.json();
    const geoJSON = osmtogeojson(rawData);

    osmGeoJSONStore.set(geoJSON);
  } catch (error) {
    console.error("Error fetching data:", error);
  }
}

export function clipData(latlngs, osmGeoJSONStore, clippedGeoJSONStore) {
  let originalGeoJSON;
  osmGeoJSONStore.subscribe((data) => {
    originalGeoJSON = data;
  })();

  if (!originalGeoJSON || !latlngs) return;

  let clippingPolygon;
  try {
    if (latlngs.center && latlngs.radius) {
      const center = [latlngs.center.lng, latlngs.center.lat];
      const radius = latlngs.radius / 1000;
      clippingPolygon = turf.circle(center, radius, { steps: 64 });
    } else {
      const closedLatLngs = [...latlngs];
      if (
        latlngs.length > 0 &&
        (latlngs[0].lat !== latlngs[latlngs.length - 1].lat ||
          latlngs[0].lng !== latlngs[latlngs.length - 1].lng)
      ) {
        closedLatLngs.push(latlngs[0]);
      }
      clippingPolygon = turf.polygon([
        closedLatLngs.map((point) => [point.lng, point.lat]),
      ]);
    }

    const clippedFeatures = originalGeoJSON.features
      .map((feature) => {
        const featureGeometry = feature.geometry;
        if (
          !featureGeometry ||
          !featureGeometry.coordinates ||
          (featureGeometry.type !== "Polygon" &&
            featureGeometry.type !== "MultiPolygon")
        ) {
          return null;
        }

        const featurePolygon = turf.geometry(
          featureGeometry.type,
          featureGeometry.coordinates
        );

        const featureCollection = turf.featureCollection([
          turf.feature(featurePolygon),
          clippingPolygon,
        ]);

        try {
          const intersection = turf.intersect(featureCollection);
          if (intersection && intersection.geometry) {
            return {
              ...feature,
              geometry: intersection.geometry,
            };
          }
        } catch (err) {
          console.warn("Error clipping feature:", feature, "Error:", err);
        }

        return null;
      })
      .filter(Boolean);

    if (clippedFeatures.length === 0) return;

    const clippedGeoJSONData = {
      type: "FeatureCollection",
      features: clippedFeatures,
    };
    clippedGeoJSONStore.set(clippedGeoJSONData);
  } catch (error) {
    console.error("Error during clipping:", error);
  }
}

export async function downloadData({
  clippedGeoJSON,
  latlngs,
  southWest,
  northEast,
  selectedLayer,
  referencePoint,
}) {
  if (!clippedGeoJSON) return;

  try {
    const zip = new JSZip();

    zip.file("buildings.geojson", JSON.stringify(clippedGeoJSON, null, 2));

    const clippedCanvas = await fetchTilesAndRenderCanvas(
      latlngs,
      southWest,
      northEast,
      selectedLayer
    );
    if (clippedCanvas) {
      const blob = await new Promise((resolve) =>
        clippedCanvas.toBlob(resolve, "image/png")
      );
      zip.file("map.png", blob);
    }

    const bbox = [southWest.lng, southWest.lat, northEast.lng, northEast.lat];
    const config = {
      bbox,
      clipPath: latlngs,
      referencePoint,
    };
    zip.file("config.json", JSON.stringify(config, null, 2));

    try {
      const scene = new THREE.Scene();
      const buildingGeometry = generateMergedBuildingsGeometry(
        clippedGeoJSON,
        referencePoint
      );
      if (buildingGeometry) {
        const material = new THREE.MeshStandardMaterial({ color: 0x999999 });
        const mesh = new THREE.Mesh(buildingGeometry, material);
        mesh.name = "Buildings";
        scene.add(mesh);
      }

      const plane = createClippingPlane(latlngs, referencePoint);
      if (plane) scene.add(plane);

      const exporter = new GLTFExporter();
      const gltfBlob = await new Promise((resolve, reject) => {
        exporter.parse(
          scene,
          (result) =>
            resolve(
              new Blob([JSON.stringify(result)], { type: "application/json" })
            ),
          reject
        );
      });
      zip.file("scene.gltf", gltfBlob);
    } catch (error) {
      console.error("Error generating 3D model:", error);
    }

    const zipBlob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vantage-scene-setup.zip";
    a.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Error during download:", error);
  }
}

export async function fetchTilesAndRenderCanvas(
  latlngs,
  southWest,
  northEast,
  selectedLayer
) {
  if (!latlngs || !selectedLayer) return null;

  const tileSize = 256;
  const zoomLevel = 17;

  const latLngToTile = (lat, lng, zoom) => {
    const scale = 2 ** zoom;
    const x = Math.floor(((lng + 180) / 360) * scale);
    const y = Math.floor(
      ((1 -
        Math.log(
          Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)
        ) /
          Math.PI) /
        2) *
        scale
    );
    return { x, y };
  };

  const topLeftTile = latLngToTile(southWest.lat, southWest.lng, zoomLevel);
  const bottomRightTile = latLngToTile(northEast.lat, northEast.lng, zoomLevel);

  const topLeftTileCoords = {
    x: Math.min(topLeftTile.x, bottomRightTile.x),
    y: Math.min(topLeftTile.y, bottomRightTile.y),
  };

  const bottomRightTileCoords = {
    x: Math.max(topLeftTile.x, bottomRightTile.x),
    y: Math.max(topLeftTile.y, bottomRightTile.y),
  };

  const tileCountX = bottomRightTileCoords.x - topLeftTileCoords.x + 1;
  const tileCountY = bottomRightTileCoords.y - topLeftTileCoords.y + 1;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  canvas.width = tileCountX * tileSize;
  canvas.height = tileCountY * tileSize;

  const tiles = [];
  for (let x = topLeftTileCoords.x; x <= bottomRightTileCoords.x; x++) {
    for (let y = topLeftTileCoords.y; y <= bottomRightTileCoords.y; y++) {
      const tileUrl = selectedLayer.value
        .replace("{z}", zoomLevel)
        .replace("{x}", x)
        .replace("{y}", y);

      tiles.push({
        url: tileUrl,
        x: x - topLeftTileCoords.x,
        y: y - topLeftTileCoords.y,
      });
    }
  }

  const tileImages = await Promise.all(
    tiles.map((tile) =>
      fetch(tile.url)
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Failed to fetch tile: ${tile.url}`);
          }
          return response.blob();
        })
        .then((blob) => createImageBitmap(blob))
        .then((img) => ({
          img,
          x: tile.x,
          y: tile.y,
        }))
    )
  );

  tileImages.forEach(({ img, x, y }) => {
    const dx = x * tileSize;
    const dy = y * tileSize;
    ctx.drawImage(img, dx, dy, tileSize, tileSize);
  });

  const latLngToPixel = (lat, lng, zoom) => {
    const scale = 2 ** zoom * tileSize;
    const x = ((lng + 180) / 360) * scale;
    const y =
      ((1 -
        Math.log(
          Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)
        ) /
          Math.PI) /
        2) *
      scale;
    return { x, y };
  };

  const topLeftPixel = latLngToPixel(northEast.lat, southWest.lng, zoomLevel);
  const bottomRightPixel = latLngToPixel(
    southWest.lat,
    northEast.lng,
    zoomLevel
  );

  const bboxX = topLeftPixel.x - topLeftTileCoords.x * tileSize;
  const bboxY = topLeftPixel.y - topLeftTileCoords.y * tileSize;
  const bboxWidth = bottomRightPixel.x - topLeftPixel.x;
  const bboxHeight = bottomRightPixel.y - topLeftPixel.y;

  const clippedCanvas = document.createElement("canvas");
  clippedCanvas.width = bboxWidth;
  clippedCanvas.height = bboxHeight;
  const clippedCtx = clippedCanvas.getContext("2d");

  clippedCtx.drawImage(
    canvas,
    bboxX,
    bboxY,
    bboxWidth,
    bboxHeight,
    0,
    0,
    bboxWidth,
    bboxHeight
  );

  return clippedCanvas;
}

function toMeters(point, reference, flipX = true) {
  if (!Array.isArray(point) || point.length !== 2) {
    throw new Error(
      "Invalid coordinate format. Expected [longitude, latitude]."
    );
  }
  const distance = turf.rhumbDistance(point, reference) * 1000;
  const bearing = (turf.rhumbBearing(point, reference) * Math.PI) / 180;

  const x = distance * Math.cos(bearing) * (flipX ? -1 : 1);
  const y = distance * Math.sin(bearing);
  return new THREE.Vector2(x, y);
}

function createClippingPlane(latlngs, referencePoint) {
  if (!latlngs) return null;

  let convertedPoints;

  if (latlngs.center && latlngs.radius) {
    const center = [latlngs.center.lng, latlngs.center.lat];
    const radiusInMeters = latlngs.radius;
    const circle = turf.circle(center, radiusInMeters / 1000, { steps: 64 });
    convertedPoints = circle.geometry.coordinates[0].map((point) =>
      toMeters(point, referencePoint)
    );
  } else if (Array.isArray(latlngs)) {
    convertedPoints = latlngs.map((latlng) => {
      const point = [latlng.lng, latlng.lat];
      return toMeters(point, referencePoint);
    });
  } else {
    console.error("Invalid latlngs format");
    return null;
  }

  if (!convertedPoints.length) return null;

  const planeShape = new THREE.Shape(
    convertedPoints.map((coord) => new THREE.Vector2(coord.x, coord.y))
  );
  const planeSize = 2;

  const extrudeSettings = {
    depth: planeSize,
    bevelEnabled: false,
  };

  const planeGeometry = new THREE.ExtrudeGeometry(planeShape, extrudeSettings);
  planeGeometry.rotateX(-Math.PI / 2);
  planeGeometry.rotateY(Math.PI / 2);
  planeGeometry.translate(0, -planeSize, 0);

  const planeMaterial = new THREE.MeshStandardMaterial({
    color: 0xdddddd,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(planeGeometry, planeMaterial);
  mesh.name = "Ground";
  return mesh;
}
