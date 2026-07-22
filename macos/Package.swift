// swift-tools-version: 6.1

import PackageDescription

let package = Package(
    name: "PlanipusMac",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "PlanipusApp", targets: ["PlanipusApp"]),
        .library(name: "PlanipusCore", targets: ["PlanipusCore"]),
        .library(name: "PlanipusGoogle", targets: ["PlanipusGoogle"]),
        .library(name: "PlanipusStore", targets: ["PlanipusStore"]),
        .library(name: "PlanipusSecrets", targets: ["PlanipusSecrets"]),
        .library(name: "PlanipusSync", targets: ["PlanipusSync"]),
        .library(name: "PlanipusDesign", targets: ["PlanipusDesign"]),
        .library(name: "PlanipusTestSupport", targets: ["PlanipusTestSupport"]),
    ],
    dependencies: [
        .package(
            url: "https://github.com/sqlcipher/GRDB.swift.git",
            exact: "7.11.1"
        ),
        // Pin the SQLCipher binary wrapper at the root as well as in
        // Package.resolved. The managed GRDB fork accepts a range, while
        // Planipus deliberately audits one exact encryption implementation.
        .package(
            url: "https://github.com/sqlcipher/SQLCipher.swift.git",
            exact: "4.17.0"
        ),
    ],
    targets: [
        .target(name: "PlanipusCore"),
        .target(
            name: "PlanipusGoogle",
            dependencies: ["PlanipusCore", "PlanipusSecrets"]
        ),
        .target(
            name: "PlanipusStore",
            dependencies: [
                "PlanipusCore",
                "PlanipusSecrets",
                .product(name: "GRDB", package: "GRDB.swift"),
                .product(name: "SQLCipher", package: "SQLCipher.swift"),
            ]
        ),
        .target(name: "PlanipusSecrets", dependencies: ["PlanipusCore"]),
        .target(
            name: "PlanipusSync",
            dependencies: ["PlanipusCore", "PlanipusGoogle", "PlanipusStore"]
        ),
        .target(name: "PlanipusDesign"),
        .target(
            name: "PlanipusTestSupport",
            dependencies: ["PlanipusCore", "PlanipusGoogle", "PlanipusStore"]
        ),
        .executableTarget(
            name: "PlanipusApp",
            dependencies: [
                "PlanipusCore",
                "PlanipusGoogle",
                "PlanipusStore",
                "PlanipusSecrets",
                "PlanipusSync",
                "PlanipusDesign",
            ]
        ),
        .testTarget(name: "PlanipusCoreTests", dependencies: ["PlanipusCore"]),
        .testTarget(
            name: "PlanipusGoogleTests",
            dependencies: [
                "PlanipusCore",
                "PlanipusGoogle",
                "PlanipusSecrets",
                "PlanipusTestSupport",
            ]
        ),
        .testTarget(
            name: "PlanipusStoreTests",
            dependencies: ["PlanipusCore", "PlanipusSecrets", "PlanipusStore"]
        ),
        .testTarget(name: "PlanipusSecretsTests", dependencies: ["PlanipusSecrets"]),
        .testTarget(
            name: "PlanipusSyncTests",
            dependencies: ["PlanipusCore", "PlanipusStore", "PlanipusSync", "PlanipusTestSupport"]
        ),
    ],
    swiftLanguageModes: [.v6]
)
