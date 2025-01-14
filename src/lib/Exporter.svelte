<script>
    import JSZip from "jszip";
    import osmtogeojson from "osmtogeojson";
    import { osmGeoJSON, clippedGeoJSON } from "./stores";
    import * as turf from "@turf/turf";

    export let area;
    export let latlngs;
    export let selectedLayer;

    const MAX_AREA = 8000000;
    let canDownload = false;
    let isProcessing = false;

    $: if (area) {
        canDownload = area <= MAX_AREA;
    }

    const calculateBoundsFromLatLngs = (latlngs) => {
        const latLngBounds = L.latLngBounds(latlngs);
        return [latLngBounds.getSouthWest(), latLngBounds.getNorthEast()];
    };

    const getData = async () => {
        if (!latlngs) {
            alert("No area selected.");
            return;
        }

        isProcessing = true;

        try {
            const [southWest, northEast] = calculateBoundsFromLatLngs(latlngs);
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
                alert("Failed to fetch GeoJSON data.");
                return;
            }

            const rawData = await response.json();
            const geoJSON = osmtogeojson(rawData);

            osmGeoJSON.set(geoJSON);
        } catch (error) {
            console.error("Error fetching data:", error);
            alert("An error occurred while fetching data.");
        } finally {
            isProcessing = false;
        }
    };

    const clipData = () => {
        let originalGeoJSON;
        osmGeoJSON.subscribe((data) => {
            originalGeoJSON = data;
        })();

        if (!originalGeoJSON || !latlngs) {
            alert("No data to clip or no shape selected.");
            return;
        }

        try {
            const closedLatLngs = [...latlngs];
            if (
                latlngs.length > 0 &&
                (latlngs[0].lat !== latlngs[latlngs.length - 1].lat ||
                    latlngs[0].lng !== latlngs[latlngs.length - 1].lng)
            ) {
                closedLatLngs.push(latlngs[0]);
            }

            const clippingPolygon = turf.polygon([
                closedLatLngs.map((point) => [point.lng, point.lat]),
            ]);

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
                alert(
                    "No features were clipped. Ensure your area intersects the data.",
                );
                return;
            }

            const clippedGeoJSONData = {
                type: "FeatureCollection",
                features: clippedFeatures,
            };

            clippedGeoJSON.set(clippedGeoJSONData);

            const [southWest, northEast] = calculateBoundsFromLatLngs(latlngs);
            const bbox = [
                southWest.lng,
                southWest.lat,
                northEast.lng,
                northEast.lat,
            ];
        } catch (error) {
            console.error("Error during clipping:", error);
            alert(`Error during clipping: ${error.message}`);
        }
    };

    const downloadData = async () => {
        const geoJSON = $clippedGeoJSON;

        if (!geoJSON) {
            alert("No clipped data available. Clip data first.");
            return;
        }

        isProcessing = true;

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

            const [southWest, northEast] = calculateBoundsFromLatLngs(latlngs);
            const bbox = [
                southWest.lng,
                southWest.lat,
                northEast.lng,
                northEast.lat,
            ];

            const config = {
                bbox: bbox,
            };
            zip.file("config.json", JSON.stringify(config, null, 2));

            const closedLatLngs = [...latlngs];
            if (
                latlngs.length > 0 &&
                (latlngs[0].lat !== latlngs[latlngs.length - 1].lat ||
                    latlngs[0].lng !== latlngs[latlngs.length - 1].lng)
            ) {
                closedLatLngs.push(latlngs[0]);
            }
            const clippingPolygon = turf.polygon([
                closedLatLngs.map((point) => [point.lng, point.lat]),
            ]);
            const clippingMaskGeoJSON = {
                type: "FeatureCollection",
                features: [turf.feature(clippingPolygon)],
            };
            zip.file(
                "clipping-mask.geojson",
                JSON.stringify(clippingMaskGeoJSON, null, 2),
            );

            const zipBlob = await zip.generateAsync({ type: "blob" });
            const url = URL.createObjectURL(zipBlob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "vantage-scene-setup.zip";
            a.click();
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error("Error during download:", error);
            alert("An error occurred during download.");
        } finally {
            isProcessing = false;
        }
    };

    const fetchTilesAndRenderCanvas = async () => {
        if (!latlngs || !selectedLayer) return null;

        const [southWest, northEast] = calculateBoundsFromLatLngs(latlngs);
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
        // Clip it instead
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
</script>

<div>
    {#if !area}
        <p>Draw a shape on the map.</p>
    {/if}

    {#if isProcessing}
        <p>Processing... Please wait.</p>
    {/if}
    {#if area && !canDownload && !isProcessing}
        <p>The selected area is too large. Please reduce the area.</p>
    {/if}
    <button on:click={getData} disabled={!canDownload || isProcessing}>
        Fetch Data
    </button>
    <button
        on:click={clipData}
        disabled={!canDownload || isProcessing || !$osmGeoJSON}
    >
        Clip Data
    </button>
    <button on:click={downloadData} disabled={!canDownload || isProcessing}>
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
