package io.aiqa.client.exception;

public class AiqaException extends RuntimeException {
    private final int statusCode;

    public AiqaException(String message, int statusCode) {
        super(message);
        this.statusCode = statusCode;
    }

    public AiqaException(String message) {
        this(message, 0);
    }

    public int getStatusCode() { return statusCode; }
}
