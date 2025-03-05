import * as THREE from "three";
import * as turf from "@turf/turf";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

function toMeters(point, reference, flipX = true) {
  if (!Array.isArray(point) || point.length < 2) {
    throw new Error(
      "Invalid coordinate format. Expected [longitude, latitude]."
    );
  }
  const lng = Number(point[0]);
  const lat = Number(point[1]);
  if (!isFinite(lng) || !isFinite(lat)) {
    throw new Error("Coordinate values must be finite numbers");
  }
  let refCoord;
  if (Array.isArray(reference) && reference.length >= 2) {
    refCoord = [Number(reference[0]), Number(reference[1])];
  } else if (
    reference &&
    typeof reference === "object" &&
    reference.lng !== undefined &&
    reference.lat !== undefined
  ) {
    refCoord = [Number(reference.lng), Number(reference.lat)];
  } else {
    throw new Error("Invalid reference coordinate");
  }

  const trimmedCoord = [lng, lat];
  const distance = turf.rhumbDistance(trimmedCoord, refCoord) * 1000;
  const bearing = (turf.rhumbBearing(trimmedCoord, refCoord) * Math.PI) / 180;
  const x = distance * Math.cos(bearing) * (flipX ? -1 : 1);
  const y = distance * Math.sin(bearing);
  return new THREE.Vector2(x, y);
}

function getShapeFromCoordinates(coords, referencePoint) {
  try {
    if (typeof coords[0] === "number") {
      const paired = [];
      for (let i = 0; i < coords.length; i += 2) {
        paired.push([coords[i], coords[i + 1]]);
      }
      coords = paired;
    }
    const validCoords = coords.filter(
      (coord) =>
        Array.isArray(coord) &&
        coord.length === 2 &&
        isFinite(coord[0]) &&
        isFinite(coord[1])
    );
    if (validCoords.length === 0) return null;

    return new THREE.Shape(
      coords.map((coord) => toMeters(coord, referencePoint))
    );
  } catch (error) {
    console.error("Error generating shape from coordinates:", coords, error);
    return null;
  }
}

function normalizeLength(lengthStr) {
  if (typeof lengthStr === "string") {
    if (lengthStr.trim().endsWith(" m")) {
      return parseFloat(lengthStr.trim().slice(0, -2));
    }
    return parseFloat(lengthStr);
  }
  return lengthStr;
}

function createWallGeometry(shape, wallHeight) {
  const extrudeSettings = {
    depth: wallHeight,
    bevelEnabled: false,
    curveSegments: 1,
  };
  const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  geometry.rotateX(-Math.PI / 2);
  geometry.rotateY(Math.PI);
  return geometry;
}

function createRoofGeometry(shape, roofHeight, roofType = "flat") {
  let geometry;
  switch (roofType.toLowerCase()) {
    case "flat": {
      const extrudeSettings = {
        depth: roofHeight,
        bevelEnabled: false,
        curveSegments: 1,
      };
      geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
      break;
    }
    case "pyramidal": {
      const points = shape.getPoints(20);
      if (points.length < 3) {
        console.warn("Not enough points for pyramidal roof");
        const extrudeSettings = {
          depth: roofHeight,
          bevelEnabled: false,
          curveSegments: 1,
        };
        geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
      } else {
        let centroid = new THREE.Vector2(0, 0);
        points.forEach((p) => centroid.add(p));
        centroid.divideScalar(points.length);

        const vertices = [];
        points.forEach((p) => vertices.push(new THREE.Vector3(p.x, p.y, 0)));
        const apexIndex = vertices.length;
        vertices.push(new THREE.Vector3(centroid.x, centroid.y, roofHeight));

        const indices = [];
        for (let i = 0; i < points.length; i++) {
          let next = (i + 1) % points.length;
          indices.push(i, next, apexIndex);
        }

        geometry = new THREE.BufferGeometry();
        const positionArray = new Float32Array(vertices.length * 3);
        vertices.forEach((v, i) => {
          positionArray[i * 3] = v.x;
          positionArray[i * 3 + 1] = v.y;
          positionArray[i * 3 + 2] = v.z;
        });
        geometry.setAttribute(
          "position",
          new THREE.BufferAttribute(positionArray, 3)
        );
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
      }
      break;
    }
    default: {
      console.warn(
        "Roof type not yet supported, falling back to flat:",
        roofType
      );
      const extrudeSettings = {
        depth: roofHeight,
        bevelEnabled: false,
        curveSegments: 1,
      };
      geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
      break;
    }
  }
  geometry.rotateX(-Math.PI / 2);
  geometry.rotateY(Math.PI);
  return geometry;
}

function generateExtraParts(feature, referencePoint) {
  const props = feature.properties;
  const extraMeshes = [];
  if (
    props["building:part"] &&
    props["building:part"].toLowerCase() === "yes" &&
    !props.building
  ) {
    const shape = getShapeFromCoordinates(
      feature.geometry.coordinates[0],
      referencePoint
    );
    if (shape) {
      const partGeometry = createWallGeometry(shape, 1);
      const partMesh = new THREE.Mesh(
        partGeometry,
        new THREE.MeshStandardMaterial({ color: 0x999999 })
      );
      partMesh.name = "BuildingPart";
      extraMeshes.push(partMesh);
    }
  }

  if (
    props["amenity"] === "place_of_worship" ||
    props["building"] === "church" ||
    props["building:part"] === "tower"
  ) {
    const towerHeight = normalizeLength(props["tower:height"] || "10");
    const geometry = new THREE.CylinderGeometry(1, 1, towerHeight, 16);
    const shape = getShapeFromCoordinates(
      feature.geometry.coordinates[0],
      referencePoint
    );
    if (shape) {
      const points = shape.getPoints(20);
      let centroid = new THREE.Vector2(0, 0);
      points.forEach((p) => centroid.add(p));
      centroid.divideScalar(points.length);
      geometry.translate(centroid.x, centroid.y, towerHeight / 2);
    }
    const towerMesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: 0x999999 })
    );
    towerMesh.name = "BuildingTower";
    extraMeshes.push(towerMesh);
  }
  return extraMeshes;
}

function generateEnhancedBuildingMesh(feature, referencePoint) {
  const props = feature.properties;
  if (!props.building && !props["building:part"]) return null;

  const coordinates = feature.geometry.coordinates;
  let outerCoords, holes;
  if (feature.geometry.type === "Polygon") {
    outerCoords = coordinates[0];
    holes = coordinates.slice(1);
  } else if (feature.geometry.type === "MultiPolygon") {
    outerCoords = coordinates[0][0];
    holes = coordinates[0].slice(1);
  } else {
    console.warn("Unsupported geometry type:", feature.geometry.type);
    return null;
  }

  const shape = getShapeFromCoordinates(outerCoords, referencePoint);
  if (!shape) return null;
  shape.holes = holes
    .map((holeCoords) => getShapeFromCoordinates(holeCoords, referencePoint))
    .filter(Boolean);

  const isPart = props["building:part"] ? true : false;

  const defaultHeight = isPart ? 2 : 4;
  let totalHeight = normalizeLength(
    props["building:height"] || props["height"] || ""
  );
  if (!totalHeight || isNaN(totalHeight) || totalHeight === 0) {
    totalHeight = props["building:levels"]
      ? parseFloat(props["building:levels"]) * (isPart ? 2 : 4)
      : defaultHeight;
  }
  let roofHeight = normalizeLength(props["roof:height"] || "");
  if (isNaN(roofHeight)) roofHeight = 0;
  const wallHeight =
    totalHeight > roofHeight ? totalHeight - roofHeight : totalHeight;

  const wallGeometry = createWallGeometry(shape, wallHeight);
  const wallMesh = new THREE.Mesh(
    wallGeometry,
    new THREE.MeshStandardMaterial({ color: 0x999999 })
  );
  wallMesh.name = "BuildingWalls";

  let roofMesh = null;
  if (roofHeight > 0) {
    const roofType = props["roof:shape"] || "flat";
    const roofGeometry = createRoofGeometry(shape, roofHeight, roofType);
    if (roofGeometry) {
      roofGeometry.translate(0, wallHeight, 0);
      roofMesh = new THREE.Mesh(
        roofGeometry,
        new THREE.MeshStandardMaterial({ color: 0x999999 })
      );
      roofMesh.name = "BuildingRoof";
    }
  }

  const buildingGroup = new THREE.Group();
  buildingGroup.add(wallMesh);
  if (roofMesh) buildingGroup.add(roofMesh);

  const extraParts = generateExtraParts(feature, referencePoint);
  extraParts.forEach((part) => buildingGroup.add(part));

  return buildingGroup;
}

function closePolygonIfNeeded(coords) {
  if (!coords || coords.length < 3) return null;

  const first = coords[0];
  const last = coords[coords.length - 1];

  if (first[0] !== last[0] || first[1] !== last[1]) {
    return [...coords, first];
  }
  return coords;
}

function containsAnyPart(buildingFeature, partsList) {
  if (!buildingFeature.geometry || !partsList.length) return false;

  const buildingCoords = closePolygonIfNeeded(
    buildingFeature.geometry.coordinates[0]
  );
  if (!buildingCoords) return false;

  const buildingPolygon = turf.polygon([buildingCoords]);

  for (const partFeature of partsList) {
    if (!partFeature.geometry) continue;

    const partCoords = closePolygonIfNeeded(
      partFeature.geometry.coordinates[0]
    );
    if (!partCoords) continue;

    const partPolygon = turf.polygon([partCoords]);

    if (turf.booleanContains(buildingPolygon, partPolygon)) {
      return true;
    }
  }
  return false;
}

export function generateEnhancedBuildings(geo, referencePoint) {
  const buildingFeatures = [];
  const buildingPartFeatures = [];

  for (const feature of geo.features) {
    const props = feature.properties;
    if (props.building && !props["building:part"]) {
      buildingFeatures.push(feature);
    } else if (props["building:part"]) {
      buildingPartFeatures.push(feature);
    }
  }

  const validBuildings = buildingFeatures.filter((bldg) => {
    return !containsAnyPart(bldg, buildingPartFeatures);
  });

  const toRender = [...validBuildings, ...buildingPartFeatures];

  const buildingMeshes = toRender
    .map((feature) => generateEnhancedBuildingMesh(feature, referencePoint))
    .filter(Boolean);

  const group = new THREE.Group();
  buildingMeshes.forEach((mesh) => group.add(mesh));
  return group;
}

export function generateMergedBuildingsGeometry(geo, referencePoint) {
  const group = generateEnhancedBuildings(geo, referencePoint);
  const geometries = [];
  group.traverse((child) => {
    if (child.isMesh) {
      child.updateMatrix();
      let geom = child.geometry.clone().applyMatrix4(child.matrix);
      if (geom.index !== null) {
        geom = geom.toNonIndexed();
      }
      if (!geom.attributes.uv) {
        const count = geom.attributes.position.count;
        const uvArray = new Float32Array(count * 2);
        geom.setAttribute("uv", new THREE.BufferAttribute(uvArray, 2));
      }
      geometries.push(geom);
    }
  });
  if (geometries.length > 0) {
    return mergeGeometries(geometries, true);
  }
  return null;
}
