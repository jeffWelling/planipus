import Foundation
import PlanipusGoogle

public actor ScriptedHTTPTransport: HTTPTransport {
    public enum ScriptError: Error, Equatable, Sendable {
        case exhausted
    }

    private var responses: [Result<HTTPResponse, ScriptError>]
    private var capturedRequests: [HTTPRequest] = []

    public init(responses: [Result<HTTPResponse, ScriptError>]) {
        self.responses = responses
    }

    public func send(_ request: HTTPRequest) throws -> HTTPResponse {
        capturedRequests.append(request)
        guard !responses.isEmpty else { throw ScriptError.exhausted }
        return try responses.removeFirst().get()
    }

    public func requests() -> [HTTPRequest] { capturedRequests }
}
