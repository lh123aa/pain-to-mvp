#!/usr/bin/env python3
"""
平台适配器基类。每个平台实现 discover() 和 crawl_comments()。
返回标准格式列表，由 storage.save_records() 写入。
"""
from abc import ABC, abstractmethod
from typing import List, Dict, Any

class BaseAdapter(ABC):
    platform: str = "base"

    @abstractmethod
    def discover(self, keyword: str, limit: int = 20) -> List[Dict[str, Any]]:
        """发现候选内容（视频/帖子），返回 [{source_id, title, url, comment_count, ...}]"""
        pass

    @abstractmethod
    def crawl_comments(self, source_id: str, limit: int = 500) -> List[Dict[str, Any]]:
        """爬取评论，返回标准格式"""
        pass

    def is_available(self) -> bool:
        """检查依赖是否安装"""
        return True
