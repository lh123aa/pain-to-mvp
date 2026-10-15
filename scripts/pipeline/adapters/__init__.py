from .bilibili import BilibiliAdapter
from .youtube import YouTubeAdapter
from .reddit import RedditAdapter
from .douyin import DouyinAdapter
from .xiaohongshu import XiaohongshuAdapter

ADAPTERS = {
    "bilibili": BilibiliAdapter,
    "youtube": YouTubeAdapter,
    "reddit": RedditAdapter,
    "douyin": DouyinAdapter,
    "xiaohongshu": XiaohongshuAdapter,
}

def get_adapter(platform: str):
    cls = ADAPTERS.get(platform)
    if not cls:
        raise ValueError(f"不支持的平台：{platform}。可选：{list(ADAPTERS.keys())}")
    return cls()
