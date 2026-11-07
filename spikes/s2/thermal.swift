import Foundation

let intervalSeconds: TimeInterval = 1
while true {
    let state: String
    switch ProcessInfo.processInfo.thermalState {
    case .nominal: state = "nominal"
    case .fair: state = "fair"
    case .serious: state = "serious"
    case .critical: state = "critical"
    @unknown default: state = "unknown"
    }
    print("\(ISO8601DateFormatter().string(from: Date())) \(state)")
    fflush(stdout)
    Thread.sleep(forTimeInterval: intervalSeconds)
}
