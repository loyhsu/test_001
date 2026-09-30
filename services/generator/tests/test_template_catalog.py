import pytest

from app.template_catalog import get_template, load_catalog


def test_catalog_contains_exactly_the_six_mvp_templates():
    catalog = load_catalog()

    assert [item.id for item in catalog] == [
        "pat-head",
        "shake-head",
        "slap",
        "kiss",
        "cry",
        "speechless",
    ]
    assert all(
        item.canvas.width == 480 and item.canvas.height == 480
        for item in catalog
    )


def test_get_template_rejects_unknown_id():
    with pytest.raises(KeyError, match="unknown-template"):
        get_template("unknown-template")
