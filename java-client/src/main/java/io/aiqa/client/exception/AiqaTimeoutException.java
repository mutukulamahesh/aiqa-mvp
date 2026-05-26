package io.aiqa.client.exception;

public class AiqaTimeoutException extends AiqaException {
    public AiqaTimeoutException(String message) {
        super(message, 0);
    }
}
