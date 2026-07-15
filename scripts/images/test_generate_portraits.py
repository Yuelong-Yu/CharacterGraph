from __future__ import annotations

import unittest
from unittest.mock import patch

import generate_portraits


class NetworkConfigurationTests(unittest.TestCase):
    def tearDown(self) -> None:
        generate_portraits.client = None

    def test_ark_client_ignores_system_proxy_by_default(self) -> None:
        captured: dict[str, object] = {}

        def fake_ark(**kwargs: object) -> object:
            captured.update(kwargs)
            return object()

        with patch.object(generate_portraits, "Ark", side_effect=fake_ark):
            generate_portraits.client = None
            generate_portraits.get_client()

        http_client = captured.get("http_client")
        self.assertIsNotNone(http_client)
        self.assertFalse(http_client.trust_env)  # type: ignore[union-attr]
        http_client.close()  # type: ignore[union-attr]

    def test_image_download_ignores_system_proxy_by_default(self) -> None:
        class FakeResponse:
            content = b"image"

            def raise_for_status(self) -> None:
                return None

        class FakeSession:
            def __init__(self) -> None:
                self.trust_env = True
                self.closed = False

            def get(self, url: str, timeout: int) -> FakeResponse:
                self.url = url
                self.timeout = timeout
                return FakeResponse()

            def close(self) -> None:
                self.closed = True

        session = FakeSession()
        with patch.object(generate_portraits.requests, "Session", return_value=session):
            content = generate_portraits.download_image("https://example.com/image.png")

        self.assertEqual(content, b"image")
        self.assertFalse(session.trust_env)
        self.assertTrue(session.closed)


if __name__ == "__main__":
    unittest.main()
