import pytest

from app.models.generation import (
    GenerationDetailResponse,
    GenerationHistoryItem,
    GenerationHistoryPage,
)


def _make_item(**overrides):
    base = {
        "id": "00000000-0000-0000-0000-000000000001",
        "prompt_excerpt": "A modern minimal office…",
        "provider": "openai",
        "model": "gpt-image-2",
        "platform_preset": "instagram_post",
        "width": 1080,
        "height": 1080,
        "logo_mode": "none",
        "status": "succeeded",
        "image_url": "https://example.com/image.png",
        "error_message": None,
        "created_at": "2026-06-07T12:30:00Z",
        "completed_at": "2026-06-07T12:30:15Z",
    }
    base.update(overrides)
    return GenerationHistoryItem(**base)


@pytest.mark.parametrize("invalid_status", ["pending", "processing"])
def test_history_item_rejects_non_terminal_status(invalid_status):
    with pytest.raises(ValueError):
        _make_item(status=invalid_status)


def test_history_item_failed_exposes_error_message():
    item = _make_item(
        status="failed",
        image_url=None,
        error_message="Rate limit exceeded",
    )
    assert item.image_url is None
    assert item.error_message == "Rate limit exceeded"


@pytest.mark.parametrize("bad_size", [0, 1, 23, 25, -1])
def test_history_page_rejects_any_size_other_than_24(bad_size):
    with pytest.raises(ValueError):
        GenerationHistoryPage(items=[], next_cursor=None, page_size=bad_size)


def test_history_detail_rejects_non_terminal_status():
    with pytest.raises(ValueError):
        GenerationDetailResponse(
            id="abc",
            prompt="text",
            provider="openai",
            model="gpt-image-2",
            platform_preset="instagram_post",
            width=1080,
            height=1080,
            logo_mode="none",
            status="pending",
            provider_request_id=None,
            image_url=None,
            download_filename=None,
            error_code=None,
            error_message=None,
            created_at="2026-06-07T12:30:00Z",
            completed_at=None,
        )
