import AppKit
import AuthenticationServices
import Foundation

@MainActor
public protocol SystemWebAuthenticationSession: Sendable {
    func authenticate(
        using authorizationURL: URL,
        callbackURLScheme: String,
        prefersEphemeralSession: Bool
    ) async throws -> URL
}

/// Native system-browser OAuth presentation. The authorization page is never
/// embedded in Planipus, and the custom-scheme callback is delivered directly
/// by AuthenticationServices.
@MainActor
public final class ASWebAuthenticationSessionRunner: NSObject,
    SystemWebAuthenticationSession,
    ASWebAuthenticationPresentationContextProviding
{
    public typealias AnchorProvider = @MainActor @Sendable () -> ASPresentationAnchor?

    private let anchorProvider: AnchorProvider
    private var activeSession: ASWebAuthenticationSession?
    private var activeAnchor: ASPresentationAnchor?
    private var continuation: CheckedContinuation<URL, any Error>?

    public init(anchorProvider: @escaping AnchorProvider) {
        self.anchorProvider = anchorProvider
    }

    public func authenticate(
        using authorizationURL: URL,
        callbackURLScheme: String,
        prefersEphemeralSession: Bool
    ) async throws -> URL {
        try Task.checkCancellation()
        guard activeSession == nil else {
            throw GoogleInstalledAppOAuthError.browserSessionInProgress
        }
        guard let anchor = anchorProvider() else {
            throw GoogleInstalledAppOAuthError.browserPresentationUnavailable
        }
        activeAnchor = anchor

        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                self.continuation = continuation
                let session = ASWebAuthenticationSession(
                    url: authorizationURL,
                    callbackURLScheme: callbackURLScheme
                ) { [weak self] callbackURL, error in
                    Task { @MainActor in
                        guard let self else { return }
                        if let callbackURL {
                            self.finish(with: .success(callbackURL))
                        } else if let sessionError = error as? ASWebAuthenticationSessionError,
                                  sessionError.code == .canceledLogin
                        {
                            self.finish(with: .failure(
                                GoogleInstalledAppOAuthError.authorizationCancelled
                            ))
                        } else {
                            self.finish(with: .failure(
                                error ?? GoogleInstalledAppOAuthError.browserSessionCouldNotStart
                            ))
                        }
                    }
                }
                session.presentationContextProvider = self
                session.prefersEphemeralWebBrowserSession = prefersEphemeralSession
                self.activeSession = session
                guard session.start() else {
                    self.finish(with: .failure(
                        GoogleInstalledAppOAuthError.browserSessionCouldNotStart
                    ))
                    return
                }
            }
        } onCancel: {
            Task { @MainActor [weak self] in
                guard let self, self.activeSession != nil else { return }
                self.activeSession?.cancel()
                self.finish(with: .failure(CancellationError()))
            }
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        _ = session
        // The anchor was captured before session start; it therefore cannot
        // silently switch windows or disappear during the callback dance.
        return activeAnchor!
    }

    private func finish(with result: Result<URL, any Error>) {
        guard let continuation else { return }
        self.continuation = nil
        activeSession = nil
        activeAnchor = nil
        continuation.resume(with: result)
    }
}
