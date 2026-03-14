"use strict";
const { getRandom } = require("./constants");

// List of realistic Chrome versions and platforms
const BROWSER_DATA = {
    windows: {
        platform: "Windows NT 10.0; Win64; x64",
        chromeVersions: ["134.0.0.0", "133.0.0.0", "132.0.0.0"],
        platformVersion: '"15.0.0"'
    },
    mac: {
        platform: "Macintosh; Intel Mac OS X 10_15_7",
        chromeVersions: ["134.0.0.0", "133.0.0.0", "132.0.0.0"],
        platformVersion: '"15.7.9"'
    },
    linux: {
        platform: "X11; Linux x86_64",
        chromeVersions: ["134.0.0.0", "133.0.0.0", "132.0.0.0"],
        platformVersion: '""'
    }
};

const defaultUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";

/**
 * Generates a realistic, randomized User-Agent string and related Sec-CH headers.
 * @returns {{userAgent: string, secChUa: string, secChUaFullVersionList: string, secChUaPlatform: string, secChUaPlatformVersion: string}}
 */
function randomUserAgent() {
    const os = getRandom(Object.keys(BROWSER_DATA));
    const data = BROWSER_DATA[os];
    const version = getRandom(data.chromeVersions);
    const majorVersion = version.split('.')[0];

    const userAgent = `Mozilla/5.0 (${data.platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
    
    // Construct the Sec-CH-UA header
    const brands = [
        `"Not(A:Brand";v="99"`,
        `"Google Chrome";v="${majorVersion}"`,
        `"Chromium";v="${majorVersion}"`
    ];
    const secChUa = brands.join(', ');
    
    // Full version list should include the full version string
    const fullVersionBrands = [
        `"Not(A:Brand";v="99.0.0.0"`,
        `"Google Chrome";v="${version}"`,
        `"Chromium";v="${version}"`
    ];
    const secChUaFullVersionList = fullVersionBrands.join(', ');

    let platformName = "Windows";
    if (os === 'mac') platformName = "macOS";
    if (os === 'linux') platformName = "Linux";

    return {
        userAgent,
        secChUa,
        secChUaFullVersionList,
        secChUaPlatform: `"${platformName}"`,
        secChUaPlatformVersion: data.platformVersion
    };
}

module.exports = {
    defaultUserAgent,
    windowsUserAgent: defaultUserAgent,
    randomUserAgent,
};