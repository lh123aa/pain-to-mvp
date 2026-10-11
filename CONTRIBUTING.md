# 贡献指南

## 一、扩展新平台

1. 在 `scripts/pipeline/adapters/` 新建 `<platform>.py`
2. 继承 `BaseAdapter`，实现 `discover()` 和 `crawl_comments()`
3. 在 `adapters/__init__.py` 注册
4. 在 `references/platform-playbooks/` 添加手册
5. 在 `data/toolkit.json` 加入工具

## 二、扩展新痛点信号

编辑 `scripts/pipeline/pain_rules.py` 的 `SIGNALS` 字典：

```python
SIGNALS = {
    "your_signal": {
        "words": ["关键词1", "关键词2"],
        "weight": 3,  # 1-5
        "label": "信号名",
    },
    ...
}
```

## 三、扩展新 MVP 模式

编辑 `references/mvp-patterns.md`，添加新模式。

## 四、扩展评分维度

编辑 `scripts/pipeline/score_opportunity.py` 的 `WEIGHTS`：

```python
WEIGHTS = {
    "demand": 0.30,
    "competition": 0.20,
    # 新维度
    "your_dim": 0.10,
}
```

同时更新 `references/scoring-rubric.md`。

## 五、提交规范

- 提交前跑：`python scripts/doctor.py` 和 `python scripts/e2e_test.py`
- Commit message：`feat:` / `fix:` / `docs:` / `chore:`
- 新增工具必须更新 `data/toolkit.json`

## 六、代码风格

- Python：PEP 8，docstring 用中文
- 所有网络请求必须经过 `compliance.py` 检查
- 所有输出必须经过 `storage.py` 标准化

## 七、自愈系统

如果自愈系统自动提交了修复，请人工 review 后再合并。
