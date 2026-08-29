// swift-tools-version: 6.0
import PackageDescription

/// The iOS client is a Swift package rather than an Xcode project so the
/// modules build and test from the command line, which is what makes them
/// verifiable in CI. The app target that hosts them arrives in T2.3.
let package = Package(
    name: "Klinik",
    // Turkish is the base language: the clinic's own staff use the app all day,
    // and patients arrive in many languages that all fall back to this one.
    defaultLocalization: "tr",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "KlinikDesign", targets: ["KlinikDesign"]),
        .library(name: "KlinikCore", targets: ["KlinikCore"]),
        .library(name: "KlinikAPI", targets: ["KlinikAPI"]),
        .library(name: "KlinikAuthFeature", targets: ["KlinikAuthFeature"]),
        .library(name: "KlinikPatientsFeature", targets: ["KlinikPatientsFeature"]),
        .library(name: "KlinikHomeFeature", targets: ["KlinikHomeFeature"]),
        .library(name: "KlinikMeasurementsFeature", targets: ["KlinikMeasurementsFeature"]),
        .library(name: "KlinikDocumentsFeature", targets: ["KlinikDocumentsFeature"]),
        .library(name: "KlinikSync", targets: ["KlinikSync"]),
    ],
    targets: [
        // Generated from design/tokens.json, shared with Android (spec 3.2).
        .target(name: "KlinikDesign"),

        // Session state, secure storage, localisation and the errors the UI
        // branches on.
        .target(name: "KlinikCore", resources: [.process("Resources")]),

        // Networking against the published OpenAPI contract.
        .target(name: "KlinikAPI", dependencies: ["KlinikCore"]),

        // Sign-in and onboarding: the flow model and its screens. The model is
        // deliberately free of SwiftUI state so it can be tested directly.
        .target(name: "KlinikAuthFeature", dependencies: ["KlinikAPI", "KlinikCore", "KlinikDesign"]),

        // The staff-side patient list and file.
        .target(name: "KlinikPatientsFeature", dependencies: ["KlinikAPI", "KlinikCore", "KlinikDesign"]),

        .testTarget(name: "KlinikAuthFeatureTests", dependencies: ["KlinikAuthFeature", "KlinikCore"]),
        // The patient's own home screen.
        .target(name: "KlinikHomeFeature", dependencies: ["KlinikAPI", "KlinikCore", "KlinikDesign"]),

        // Body measurements and the charts drawn from them (spec M2).
        .target(
            name: "KlinikMeasurementsFeature",
            dependencies: ["KlinikAPI", "KlinikCore", "KlinikDesign"]
        ),

        .testTarget(name: "KlinikPatientsFeatureTests", dependencies: ["KlinikPatientsFeature", "KlinikCore"]),
        // Document upload and the queue's progress (spec M2, T3.2).
        .target(
            name: "KlinikDocumentsFeature",
            dependencies: ["KlinikAPI", "KlinikCore", "KlinikDesign"]
        ),

        .testTarget(
            name: "KlinikMeasurementsFeatureTests",
            dependencies: ["KlinikMeasurementsFeature", "KlinikCore"]
        ),
        .testTarget(
            name: "KlinikDocumentsFeatureTests",
            dependencies: ["KlinikDocumentsFeature", "KlinikCore"]
        ),
        // Offline queue and synchronisation (spec M15).
        .target(name: "KlinikSync", dependencies: ["KlinikCore"]),

        .testTarget(name: "KlinikHomeFeatureTests", dependencies: ["KlinikHomeFeature", "KlinikCore"]),
        .testTarget(name: "KlinikSyncTests", dependencies: ["KlinikSync", "KlinikCore"]),
        .testTarget(name: "KlinikDesignTests", dependencies: ["KlinikDesign"]),
        .testTarget(name: "KlinikCoreTests", dependencies: ["KlinikCore"]),
        .testTarget(name: "KlinikAPITests", dependencies: ["KlinikAPI", "KlinikCore"]),
    ]
)
