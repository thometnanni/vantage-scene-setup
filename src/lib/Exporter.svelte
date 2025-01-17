<script>
    import JSZip from "jszip";
    import osmtogeojson from "osmtogeojson";
    import { osmGeoJSON, clippedGeoJSON } from "./stores";
    import * as turf from "@turf/turf";
    import * as THREE from "three";
    import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
    import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

    export let area;
    export let latlngs;
    export let selectedLayer;
    let clippingPolygon;
    let southWest, northEast;

    const MAX_AREA = 8000000;
    let canDownload = false;

    $: if (area) {
        canDownload = area <= MAX_AREA;
    }

    const calculateBoundsFromLatLngs = (latlngs) => {
        const latLngBounds = L.latLngBounds(latlngs);
        return [latLngBounds.getSouthWest(), latLngBounds.getNorthEast()];
    };

    const getData = async () => {
        if (!latlngs) {
            return;
        }

        if (latlngs.center && latlngs.radius) {
            const center = latlngs.center;
            const radiusInDegrees = latlngs.radius / 111320; // degrees
            southWest = {
                lat: center.lat - radiusInDegrees,
                lng: center.lng - radiusInDegrees,
            };
            northEast = {
                lat: center.lat + radiusInDegrees,
                lng: center.lng + radiusInDegrees,
            };
        } else if (Array.isArray(latlngs)) {
            [southWest, northEast] = calculateBoundsFromLatLngs(latlngs);
        } else {
            return;
        }

        try {
            const overpassUrl = `https://overpass-api.de/api/interpreter`;
            const query = `
            [out:json];
            (
                way["building"](${southWest.lat},${southWest.lng},${northEast.lat},${northEast.lng});
                relation["building"](${southWest.lat},${southWest.lng},${northEast.lat},${northEast.lng});
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

            if (!response.ok) {
                return;
            }

            const rawData = await response.json();
            const geoJSON = osmtogeojson(rawData);

            osmGeoJSON.set(geoJSON);
        } catch (error) {
            console.error("Error fetching data:", error);
        }
    };

    const clipData = () => {
        let originalGeoJSON;
        osmGeoJSON.subscribe((data) => {
            originalGeoJSON = data;
        })();

        if (!originalGeoJSON || !latlngs) {
            return;
        }

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
                        featureGeometry.coordinates,
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
                        console.warn(
                            "Error clipping feature:",
                            feature,
                            "Error:",
                            err,
                        );
                    }

                    return null;
                })
                .filter(Boolean);

            if (clippedFeatures.length === 0) {
                return;
            }

            const clippedGeoJSONData = {
                type: "FeatureCollection",
                features: clippedFeatures,
            };

            clippedGeoJSON.set(clippedGeoJSONData);
        } catch (error) {
            console.error("Error during clipping:", error);
        }
    };

    const downloadData = async () => {
        const geoJSON = $clippedGeoJSON;

        if (!geoJSON) {
            return;
        }

        try {
            const zip = new JSZip();

            zip.file("buildings.geojson", JSON.stringify(geoJSON, null, 2));

            const clippedCanvas = await fetchTilesAndRenderCanvas();
            if (clippedCanvas) {
                const blob = await new Promise((resolve) =>
                    clippedCanvas.toBlob(resolve, "image/png"),
                );
                zip.file("map.png", blob);
            }

            const bbox = [
                southWest.lng,
                southWest.lat,
                northEast.lng,
                northEast.lat,
            ];

            const config = {
                bbox: bbox,
                clipPath: latlngs,
                referencePoint:
                    turf.centroid($clippedGeoJSON).geometry.coordinates,
            };

            const configString = JSON.stringify(config, null, 2);
            navigator.clipboard.writeText(
                `${turf.centroid($clippedGeoJSON).geometry.coordinates}`,
            );

            zip.file("config.json", JSON.stringify(config, null, 2));

            try {
                const referencePoint =
                    turf.centroid(geoJSON).geometry.coordinates;
                const buildingGeometry = generateBuildings(
                    geoJSON,
                    referencePoint,
                );

                const scene = new THREE.Scene();
                const material = new THREE.MeshStandardMaterial({
                    color: 0x999999,
                });
                const mesh = new THREE.Mesh(buildingGeometry, material);
                scene.add(mesh);

                let convertedPoints;

                if (latlngs.center && latlngs.radius) {
                    const center = [latlngs.center.lng, latlngs.center.lat];
                    const radiusInMeters = latlngs.radius;
                    const circle = turf.circle(center, radiusInMeters / 1000, {
                        steps: 64,
                    });
                    convertedPoints = circle.geometry.coordinates[0].map(
                        (point) => {
                            return toMeters(point, referencePoint);
                        },
                    );
                } else if (Array.isArray(latlngs)) {
                    convertedPoints = latlngs.map((latlng) => {
                        const point = [latlng.lng, latlng.lat];
                        return toMeters(point, referencePoint);
                    });
                } else {
                    console.error("Invalid latlngs format");
                    return;
                }

                const planeShape = new THREE.Shape(
                    convertedPoints.map(
                        (coord) => new THREE.Vector2(coord.x, coord.y),
                    ),
                );

                const planeSize = 2;

                const extrudeSettings = {
                    depth: planeSize,
                    bevelEnabled: false,
                };

                const planeGeometry = new THREE.ExtrudeGeometry(
                    planeShape,
                    extrudeSettings,
                );

                planeGeometry.rotateX(Math.PI / 2);
                planeGeometry.rotateZ(Math.PI);
                // planeGeometry.translate(0, -planeSize, 0);

                const planeMaterial = new THREE.MeshStandardMaterial({
                    color: 0xdddddd,
                    side: THREE.DoubleSide,
                });
                const plane = new THREE.Mesh(planeGeometry, planeMaterial);

                scene.add(plane);

                const exporter = new GLTFExporter();
                const gltfBlob = await new Promise((resolve, reject) => {
                    exporter.parse(
                        scene,
                        (result) =>
                            resolve(
                                new Blob([JSON.stringify(result)], {
                                    type: "application/json",
                                }),
                            ),
                        reject,
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
    };

    const fetchTilesAndRenderCanvas = async () => {
        if (!latlngs || !selectedLayer) return null;

        const tileSize = 256;
        const zoomLevel = 17;

        const latLngToTile = (lat, lng, zoom) => {
            const scale = Math.pow(2, zoom);
            const x = Math.floor(((lng + 180) / 360) * scale);
            const y = Math.floor(
                ((1 -
                    Math.log(
                        Math.tan((lat * Math.PI) / 180) +
                            1 / Math.cos((lat * Math.PI) / 180),
                    ) /
                        Math.PI) /
                    2) *
                    scale,
            );
            return { x, y };
        };

        const topLeftTile = latLngToTile(
            southWest.lat,
            southWest.lng,
            zoomLevel,
        );
        const bottomRightTile = latLngToTile(
            northEast.lat,
            northEast.lng,
            zoomLevel,
        );

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
            for (
                let y = topLeftTileCoords.y;
                y <= bottomRightTileCoords.y;
                y++
            ) {
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
                            throw new Error(
                                `Failed to fetch tile: ${tile.url}`,
                            );
                        }
                        return response.blob();
                    })
                    .then((blob) => createImageBitmap(blob))
                    .then((img) => ({
                        img,
                        x: tile.x,
                        y: tile.y,
                    })),
            ),
        );

        tileImages.forEach(({ img, x, y }) => {
            const dx = x * tileSize;
            const dy = y * tileSize;
            ctx.drawImage(img, dx, dy, tileSize, tileSize);
        });

        //return canvas
        const latLngToPixel = (lat, lng, zoom) => {
            const scale = Math.pow(2, zoom) * tileSize;
            const x = ((lng + 180) / 360) * scale;
            const y =
                ((1 -
                    Math.log(
                        Math.tan((lat * Math.PI) / 180) +
                            1 / Math.cos((lat * Math.PI) / 180),
                    ) /
                        Math.PI) /
                    2) *
                scale;
            return { x, y };
        };

        const topLeftPixel = latLngToPixel(
            northEast.lat,
            southWest.lng,
            zoomLevel,
        );
        const bottomRightPixel = latLngToPixel(
            southWest.lat,
            northEast.lng,
            zoomLevel,
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
            bboxHeight,
        );

        return clippedCanvas;
    };

    const generateBuildings = (geo, referencePoint) => {
        const buildings = geo.features
            .filter(({ properties }) => properties.building)
            .flatMap((feature) => {
                const coordinates = feature.geometry.coordinates;

                if (!coordinates) return null;

                if (feature.geometry.type === "Polygon") {
                    return createBuildingGeometry(
                        coordinates,
                        referencePoint,
                        feature.properties,
                    );
                } else if (feature.geometry.type === "MultiPolygon") {
                    return coordinates.flatMap((polygon) =>
                        createBuildingGeometry(
                            polygon,
                            referencePoint,
                            feature.properties,
                        ),
                    );
                } else {
                    console.warn(
                        "Unsupported geometry type:",
                        feature.geometry.type,
                    );
                    return null;
                }
            })
            .filter(Boolean);

        return mergeGeometries(buildings);
    };

    const createBuildingGeometry = (
        coordinates,
        referencePoint,
        properties,
    ) => {
        const shape = getShapeFromCoordinates(coordinates[0], referencePoint);
        if (!shape) return null;

        shape.holes = coordinates
            .slice(1)
            .map((hole) => getShapeFromCoordinates(hole, referencePoint));

        const geometry = new THREE.ExtrudeGeometry(shape, {
            curveSegments: 1,
            depth: getBuildingHeight(properties),
            bevelEnabled: false,
        });

        geometry.rotateX(Math.PI / 2);
        geometry.rotateZ(Math.PI);
        return geometry;
    };

    const getBuildingHeight = (properties) => {
        return (
            properties["building:height"] ??
            properties["height"] ??
            (properties["building:levels"]
                ? properties["building:levels"] * 4
                : 4)
        );
    };

    const getShapeFromCoordinates = (coordinates, referencePoint) => {
        try {
            return new THREE.Shape(
                coordinates.map((coord) => toMeters(coord, referencePoint)),
            );
        } catch (error) {
            console.error(
                "Error generating shape from coordinates:",
                coordinates,
                error,
            );
            return null;
        }
    };

    const toMeters = (point, reference, flipX = true) => {
        if (!Array.isArray(point) || point.length !== 2) {
            throw new Error(
                "Invalid coordinate format. Expected [longitude, latitude].",
            );
        }

        const distance = turf.rhumbDistance(point, reference) * 1000;
        const bearing = (turf.rhumbBearing(point, reference) * Math.PI) / 180;

        const x = distance * Math.cos(bearing) * (flipX ? -1 : 1);
        const y = distance * Math.sin(bearing);

        return new THREE.Vector2(x, y);
    };
</script>

<div>
    {#if !area}
        <p>Draw a shape on the map.</p>
    {/if}

    {#if area && !canDownload}
        <p>The selected area is too large. Please reduce the area.</p>
    {/if}
    <button on:click={getData} disabled={!area}> Fetch Data </button>
    <button on:click={clipData} disabled={!$osmGeoJSON}> Clip Data </button>
    <button on:click={downloadData} disabled={!$clippedGeoJSON}>
        Download Data
    </button>
</div>

<style>
    div {
        margin: 10px 0;
    }

    button {
        cursor: pointer;
        opacity: 1;
    }

    button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    p {
        margin-top: 10px;
        color: red;
    }
</style>
