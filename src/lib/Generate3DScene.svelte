<script>
    import { osmGeoJSON, clippedGeoJSON } from "./stores";
    import * as THREE from "three";
    import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
    import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
    import * as turf from "@turf/turf";

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

    const export3DScene = async () => {
        let geoJSONData;
        clippedGeoJSON.subscribe((data) => (geoJSONData = data))();

        if (!geoJSONData) {
            alert("No clipped GeoJSON available to generate the 3D scene.");
            return;
        }

        try {
            const referencePoint =
                turf.centroid(geoJSONData).geometry.coordinates;

            const buildingGeometry = generateBuildings(
                geoJSONData,
                referencePoint,
            );

            const scene = new THREE.Scene();
            const material = new THREE.MeshStandardMaterial({
                color: 0x999999,
            });
            const mesh = new THREE.Mesh(buildingGeometry, material);
            scene.add(mesh);

            const exporter = new GLTFExporter();

            exporter.parse(
                scene,
                (gltf) => {
                    const blob = new Blob([JSON.stringify(gltf)], {
                        type: "application/json",
                    });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "scene.gltf";
                    a.click();
                    URL.revokeObjectURL(url);
                },
                (error) => {
                    console.error(
                        "An error occurred while exporting the 3D scene:",
                        error,
                    );
                    alert("Error during GLTF export.");
                },
                { binary: false },
            );
        } catch (error) {
            console.error("Error generating 3D scene:", error);
            alert("An error occurred while generating the 3D scene.");
        }
    };
</script>

<div>
    <button on:click={export3DScene}> Export 3D Scene </button>
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
        color: blue;
    }
</style>
