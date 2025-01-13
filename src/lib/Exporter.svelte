<script>
    import JSZip from "jszip";
    import osmtogeojson from "osmtogeojson";

    export let area;
    export let latlngs;
    export let selectedLayer;

    const MAX_AREA = 50000000;
    let canDownload = false;

    const checkArea = () => {
        canDownload = area <= MAX_AREA;
    };

    $: if (area) {
        checkArea();
    }

    const calculateBoundsFromLatLngs = (latlngs) => {
        const latLngBounds = L.latLngBounds(latlngs);
        return [latLngBounds.getSouthWest(), latLngBounds.getNorthEast()];
    };

    const fetchGeoJSON = async () => {
        if (!latlngs) return null;

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
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });

        if (!response.ok) {
            alert("Failed to fetch GeoJSON data.");
            return null;
        }

        const rawData = await response.json();
        const geoJSON = osmtogeojson(rawData);
        return geoJSON;
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

        console.log("Tile counts:", { tileCountX, tileCountY });

        if (tileCountX <= 0 || tileCountY <= 0) {
            console.error("Invalid tile counts:", { tileCountX, tileCountY });
            return null;
        }

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

        return canvas;
    };

    const handleDownload = async () => {
        if (!canDownload) {
            alert("The area is too large or the zoom level is too low.");
            return;
        }

        console.log("Handle Download");

        const zip = new JSZip();

        const geoJSON = await fetchGeoJSON();
        if (geoJSON) {
            zip.file("buildings.geojson", JSON.stringify(geoJSON, null, 2));
        }

        const canvas = await fetchTilesAndRenderCanvas();
        if (canvas) {
            const blob = await new Promise((resolve) =>
                canvas.toBlob(resolve, "image/png"),
            );
            zip.file("map-tiles.png", blob);
        }

        const zipBlob = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "vantage-scene-setup.zip";
        a.click();
        URL.revokeObjectURL(url);
    };
</script>

<div>
    {#if !canDownload}
        <p>The selected area is too large. Please reduce the area.</p>
    {/if}
    <button on:click={handleDownload} disabled={!canDownload}>
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
