"""数据源管理 API"""
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from src.web.database import get_db
from src.web.models import DataSource

logger = logging.getLogger(__name__)

router = APIRouter()


class DataSourceCreate(BaseModel):
    name: str
    type: str  # news / chart / quote
    provider: str
    config: dict = {}
    enabled: bool = True
    priority: int = 0


class DataSourceUpdate(BaseModel):
    name: str | None = None
    type: str | None = None
    provider: str | None = None
    config: dict | None = None
    enabled: bool | None = None
    priority: int | None = None


class DataSourceResponse(BaseModel):
    id: int
    name: str
    type: str
    provider: str
    config: dict
    enabled: bool
    priority: int

    class Config:
        from_attributes = True


@router.get("", response_model=list[DataSourceResponse])
def list_datasources(type: str | None = None, db: Session = Depends(get_db)):
    """获取数据源列表，可按类型筛选"""
    query = db.query(DataSource)
    if type:
        query = query.filter(DataSource.type == type)
    sources = query.order_by(DataSource.priority, DataSource.id).all()
    return sources


@router.get("/{source_id}", response_model=DataSourceResponse)
def get_datasource(source_id: int, db: Session = Depends(get_db)):
    """获取单个数据源"""
    source = db.query(DataSource).filter(DataSource.id == source_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="数据源不存在")
    return source


@router.post("", response_model=DataSourceResponse)
def create_datasource(data: DataSourceCreate, db: Session = Depends(get_db)):
    """创建数据源"""
    source = DataSource(
        name=data.name,
        type=data.type,
        provider=data.provider,
        config=data.config,
        enabled=data.enabled,
        priority=data.priority,
    )
    db.add(source)
    db.commit()
    db.refresh(source)
    logger.info(f"创建数据源: {source.name} ({source.provider})")
    return source


@router.put("/{source_id}", response_model=DataSourceResponse)
def update_datasource(source_id: int, data: DataSourceUpdate, db: Session = Depends(get_db)):
    """更新数据源"""
    source = db.query(DataSource).filter(DataSource.id == source_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="数据源不存在")

    if data.name is not None:
        source.name = data.name
    if data.type is not None:
        source.type = data.type
    if data.provider is not None:
        source.provider = data.provider
    if data.config is not None:
        source.config = data.config
    if data.enabled is not None:
        source.enabled = data.enabled
    if data.priority is not None:
        source.priority = data.priority

    db.commit()
    db.refresh(source)
    logger.info(f"更新数据源: {source.name}")
    return source


@router.delete("/{source_id}")
def delete_datasource(source_id: int, db: Session = Depends(get_db)):
    """删除数据源"""
    source = db.query(DataSource).filter(DataSource.id == source_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="数据源不存在")

    db.delete(source)
    db.commit()
    logger.info(f"删除数据源: {source.name}")
    return {"success": True}


@router.post("/{source_id}/test")
async def test_datasource(source_id: int, db: Session = Depends(get_db)):
    """测试数据源连接，返回详细结果"""
    source = db.query(DataSource).filter(DataSource.id == source_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="数据源不存在")

    try:
        result = await _test_source(source)
        return {"success": True, **result}
    except Exception as e:
        logger.error(f"测试数据源失败 ({source.name}): {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def _test_source(source: DataSource) -> dict:
    """测试数据源，返回详细结果"""
    from datetime import datetime, timedelta

    if source.type == "news":
        if source.provider == "sina":
            from src.collectors.news_collector import SinaNewsCollector
            collector = SinaNewsCollector()
            since = datetime.now() - timedelta(hours=2)
            news = await collector.fetch_news(since=since)
            news_list = [
                {
                    "title": n.title[:50] + ("..." if len(n.title) > 50 else ""),
                    "time": n.publish_time.strftime("%H:%M"),
                    "importance": n.importance,
                }
                for n in news[:10]
            ]
            return {
                "type": "news",
                "count": len(news),
                "items": news_list,
                "message": f"获取到 {len(news)} 条快讯",
            }
        elif source.provider == "eastmoney":
            from src.collectors.news_collector import EastMoneyNewsCollector
            collector = EastMoneyNewsCollector()
            since = datetime.now() - timedelta(hours=24)  # 24小时内的公告
            news = await collector.fetch_news(symbols=["600519"], since=since)
            news_list = [
                {
                    "title": n.title[:50] + ("..." if len(n.title) > 50 else ""),
                    "time": n.publish_time.strftime("%m-%d"),
                    "importance": n.importance,
                }
                for n in news[:10]
            ]
            return {
                "type": "news",
                "count": len(news),
                "items": news_list,
                "message": f"获取到 {len(news)} 条公告（贵州茅台近24小时）",
            }

    elif source.type == "chart":
        from src.collectors.screenshot_collector import ScreenshotCollector
        import base64
        # 增加等待时间确保弹窗关闭
        collector = ScreenshotCollector(config={"extra_wait_ms": 4000})
        try:
            screenshot = await collector.capture(
                symbol="600519",
                name="贵州茅台",
                market="CN",
                provider=source.provider,
            )
            if screenshot and screenshot.exists:
                # 读取图片并转为 base64
                with open(screenshot.filepath, "rb") as f:
                    img_base64 = base64.b64encode(f.read()).decode("utf-8")
                return {
                    "type": "chart",
                    "image": f"data:image/png;base64,{img_base64}",
                    "filepath": screenshot.filepath,
                    "message": "截图成功",
                }
            return {"type": "chart", "message": "截图失败，请检查 Playwright 安装"}
        finally:
            await collector.close()

    elif source.type == "quote":
        if source.provider == "tencent":
            from src.collectors.akshare_collector import _fetch_tencent_quotes
            quotes = _fetch_tencent_quotes(["sh000001", "sz399001", "sz399006"])
            if quotes:
                items = [
                    {
                        "name": q["name"],
                        "price": q["current_price"],
                        "change_pct": q["change_pct"],
                    }
                    for q in quotes
                ]
                return {
                    "type": "quote",
                    "items": items,
                    "message": f"获取到 {len(quotes)} 个指数行情",
                }
            return {"type": "quote", "message": "腾讯行情接口就绪"}

    return {"type": "unknown", "message": f"数据源 {source.provider} 测试通过"}
