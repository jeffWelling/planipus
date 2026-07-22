import Foundation
import PlanipusGoogle

@MainActor
public final class ScriptedWebAuthenticationSession: SystemWebAuthenticationSession {
    public struct Request: Sendable, Equatable {
        public let authorizationURL: URL
        public let callbackURLScheme: String
        public let prefersEphemeralSession: Bool
    }

    public typealias Handler = @MainActor @Sendable (Request) throws -> URL

    private let handler: Handler
    private var capturedRequests: [Request] = []

    public init(handler: @escaping Handler) {
        self.handler = handler
    }

    public func authenticate(
        using authorizationURL: URL,
        callbackURLScheme: String,
        prefersEphemeralSession: Bool
    ) async throws -> URL {
        let request = Request(
            authorizationURL: authorizationURL,
            callbackURLScheme: callbackURLScheme,
            prefersEphemeralSession: prefersEphemeralSession
        )
        capturedRequests.append(request)
        return try handler(request)
    }

    public func requests() -> [Request] { capturedRequests }
}
