from typing import Any
import httpx
from app.plugins.base_plugin import BasePlugin


class RechargePlugin(BasePlugin):
    name = "recharge"
    display_name = "Motivation & Recharge"
    description = (
        "Curated motivation hub with uplifting articles, videos, audio picks, "
        "and a quote feed to help you recharge."
    )

    async def get_context(self, user_id: int, db: Any) -> str | None:
        return None

    def articles(self) -> list[dict]:
        return [
            {
                "title": "How to Build Better Habits",
                "source": "James Clear",
                "url": "https://jamesclear.com/three-steps-habit-change",
                "summary": "Practical habit framework for small, sustainable progress.",
            },
            {
                "title": "Resilience Guide",
                "source": "Mind UK",
                "url": "https://www.mind.org.uk/information-support/tips-for-everyday-living/wellbeing/wellbeing/",
                "summary": "Actionable tips for wellbeing, energy, and emotional resilience.",
            },
            {
                "title": "Self-care for Stress",
                "source": "CDC",
                "url": "https://www.cdc.gov/howrightnow/taking-care/index.html",
                "summary": "Evidence-based stress management and self-care recommendations.",
            },
            {
                "title": "Tiny Joy Practices",
                "source": "Greater Good Science Center",
                "url": "https://greatergood.berkeley.edu/topic/happiness/definition",
                "summary": "Science-backed ideas to add small moments of joy each day.",
            },
        ]

    def videos(self) -> list[dict]:
        return [
            {
                "title": "How to Make Stress Your Friend",
                "source": "TED",
                "url": "https://www.ted.com/talks/kelly_mcgonigal_how_to_make_stress_your_friend",
                "summary": "Reframing stress can improve confidence and outcomes.",
            },
            {
                "title": "The Happy Secret to Better Work",
                "source": "TED",
                "url": "https://www.ted.com/talks/shawn_achor_the_happy_secret_to_better_work",
                "summary": "Positive habits can unlock focus, creativity, and productivity.",
            },
            {
                "title": "Guided Breathing for Calm",
                "source": "YouTube",
                "url": "https://www.youtube.com/watch?v=SEfs5TJZ6Nk",
                "summary": "Short breathing video for grounding and mental reset.",
            },
        ]

    def audio(self) -> list[dict]:
        return [
            {
                "title": "Meditation Minis",
                "source": "Podcast",
                "url": "https://meditationminis.com/podcast/",
                "summary": "Short guided meditations for stress, sleep, and recharge.",
            },
            {
                "title": "The Happiness Lab",
                "source": "Podcast",
                "url": "https://www.pushkin.fm/podcasts/the-happiness-lab-with-dr-laurie-santos",
                "summary": "Psychology-based episodes on happiness and healthy habits.",
            },
            {
                "title": "Nature Soundscapes",
                "source": "YouTube Music",
                "url": "https://music.youtube.com/search?q=nature+sounds+relax",
                "summary": "Ambient audio for focus, rest, and decompression.",
            },
        ]

    async def quote(self) -> dict:
        fallback = {
            "text": "Small steps every day still move you forward.",
            "author": "AccessBot",
            "source": "local",
        }

        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(8.0, connect=4.0)) as client:
                response = await client.get("https://zenquotes.io/api/random")
                response.raise_for_status()
                data = response.json()
                if isinstance(data, list) and data:
                    q = data[0]
                    return {
                        "text": q.get("q") or fallback["text"],
                        "author": q.get("a") or "Unknown",
                        "source": "zenquotes",
                    }
        except Exception:
            pass

        return fallback


recharge_plugin = RechargePlugin()
