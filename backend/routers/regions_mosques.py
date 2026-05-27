import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.auth import decode_access_token, AccessTokenError
from models.auth import User
from models.regions import Regions
from models.mosques import Mosques

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/locations", tags=["locations"])


# ---------- Pydantic Schemas ----------
class RegionItem(BaseModel):
    id: int
    name: str

    class Config:
        from_attributes = True


class MosqueItem(BaseModel):
    id: int
    name: str
    region_id: int

    class Config:
        from_attributes = True


class RegionWithMosques(BaseModel):
    id: int
    name: str
    mosques: List[MosqueItem]


class CreateRegionRequest(BaseModel):
    name: str


class CreateMosqueRequest(BaseModel):
    name: str
    region_id: int


class BulkCreateMosqueRequest(BaseModel):
    names: List[str]
    region_id: int


class UpdateRegionRequest(BaseModel):
    id: int
    name: str


class UpdateMosqueRequest(BaseModel):
    id: int
    name: str
    region_id: Optional[int] = None


class DeleteRequest(BaseModel):
    id: int


# ---------- Helper: require admin ----------
async def require_admin(request: Request, db: AsyncSession) -> dict:
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="غير مصرح")
    token = auth_header[7:]
    try:
        payload = decode_access_token(token)
    except AccessTokenError:
        raise HTTPException(status_code=401, detail="رمز غير صالح")

    user_id = payload.get("sub")
    role = payload.get("role", "user")

    if role not in ("admin", "owner"):
        # Check DB
        user_query = select(User).where(User.id == user_id)
        user_result = await db.execute(user_query)
        db_user = user_result.scalar_one_or_none()
        if not db_user or db_user.role not in ("admin", "owner"):
            raise HTTPException(status_code=403, detail="صلاحيات المسؤول مطلوبة")
        role = db_user.role

    return {"id": user_id, "role": role}


# ---------- Public: Get all regions with mosques ----------
@router.get("/regions-with-mosques", response_model=List[RegionWithMosques])
async def get_regions_with_mosques(
    db: AsyncSession = Depends(get_db),
):
    """Get all regions with their mosques (public endpoint)."""
    try:
        regions_query = select(Regions).order_by(Regions.name)
        regions_result = await db.execute(regions_query)
        regions = regions_result.scalars().all()

        mosques_query = select(Mosques).order_by(Mosques.name)
        mosques_result = await db.execute(mosques_query)
        all_mosques = mosques_result.scalars().all()

        # Group mosques by region_id
        mosques_by_region: dict[int, list] = {}
        for m in all_mosques:
            if m.region_id not in mosques_by_region:
                mosques_by_region[m.region_id] = []
            mosques_by_region[m.region_id].append(
                MosqueItem(id=m.id, name=m.name, region_id=m.region_id)
            )

        result = []
        for r in regions:
            result.append(
                RegionWithMosques(
                    id=r.id,
                    name=r.name,
                    mosques=mosques_by_region.get(r.id, []),
                )
            )
        return result
    except Exception as e:
        logger.error(f"Error fetching regions with mosques: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ---------- Admin: Create region ----------
@router.post("/regions", response_model=RegionItem)
async def create_region(
    data: CreateRegionRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    await require_admin(request, db)
    try:
        region = Regions(
            name=data.name.strip(),
            created_at=datetime.now(timezone.utc),
        )
        db.add(region)
        await db.commit()
        await db.refresh(region)
        return region
    except Exception as e:
        await db.rollback()
        logger.error(f"Error creating region: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ---------- Admin: Update region ----------
@router.post("/regions/update", response_model=RegionItem)
async def update_region(
    data: UpdateRegionRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    await require_admin(request, db)
    try:
        query = select(Regions).where(Regions.id == data.id)
        result = await db.execute(query)
        region = result.scalar_one_or_none()
        if not region:
            raise HTTPException(status_code=404, detail="المنطقة غير موجودة")
        region.name = data.name.strip()
        await db.commit()
        await db.refresh(region)
        return region
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error updating region: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ---------- Admin: Delete region ----------
@router.post("/regions/delete")
async def delete_region(
    data: DeleteRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    await require_admin(request, db)
    try:
        query = select(Regions).where(Regions.id == data.id)
        result = await db.execute(query)
        region = result.scalar_one_or_none()
        if not region:
            raise HTTPException(status_code=404, detail="المنطقة غير موجودة")
        # Delete all mosques in this region first
        await db.execute(delete(Mosques).where(Mosques.region_id == data.id))
        await db.delete(region)
        await db.commit()
        return {"message": "تم حذف المنطقة بنجاح"}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error deleting region: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ---------- Admin: Create mosque ----------
@router.post("/mosques", response_model=MosqueItem)
async def create_mosque(
    data: CreateMosqueRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    await require_admin(request, db)
    try:
        # Verify region exists
        region_query = select(Regions).where(Regions.id == data.region_id)
        region_result = await db.execute(region_query)
        if not region_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="المنطقة غير موجودة")

        mosque = Mosques(
            name=data.name.strip(),
            region_id=data.region_id,
            created_at=datetime.now(timezone.utc),
        )
        db.add(mosque)
        await db.commit()
        await db.refresh(mosque)
        return mosque
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error creating mosque: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ---------- Admin: Bulk create mosques ----------
@router.post("/mosques/bulk")
async def bulk_create_mosques(
    data: BulkCreateMosqueRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Create multiple mosques at once. Each name should be non-empty."""
    await require_admin(request, db)
    try:
        # Verify region exists
        region_query = select(Regions).where(Regions.id == data.region_id)
        region_result = await db.execute(region_query)
        if not region_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="المنطقة غير موجودة")

        now = datetime.now(timezone.utc)
        created = 0
        skipped = 0

        for raw_name in data.names:
            name = raw_name.strip()
            if not name:
                continue
            # Check if mosque already exists in this region
            existing = await db.execute(
                select(Mosques).where(
                    Mosques.name == name,
                    Mosques.region_id == data.region_id,
                )
            )
            if existing.scalar_one_or_none():
                skipped += 1
                continue
            mosque = Mosques(name=name, region_id=data.region_id, created_at=now)
            db.add(mosque)
            created += 1

        await db.commit()
        return {
            "message": f"تم إضافة {created} مسجد بنجاح" + (f" (تم تخطي {skipped} مسجد موجود مسبقاً)" if skipped else ""),
            "created": created,
            "skipped": skipped,
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error bulk creating mosques: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ---------- Admin: Update mosque ----------
@router.post("/mosques/update", response_model=MosqueItem)
async def update_mosque(
    data: UpdateMosqueRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    await require_admin(request, db)
    try:
        query = select(Mosques).where(Mosques.id == data.id)
        result = await db.execute(query)
        mosque = result.scalar_one_or_none()
        if not mosque:
            raise HTTPException(status_code=404, detail="المسجد غير موجود")
        mosque.name = data.name.strip()
        if data.region_id is not None:
            mosque.region_id = data.region_id
        await db.commit()
        await db.refresh(mosque)
        return mosque
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error updating mosque: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ---------- Admin: Delete mosque ----------
@router.post("/mosques/delete")
async def delete_mosque(
    data: DeleteRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    await require_admin(request, db)
    try:
        query = select(Mosques).where(Mosques.id == data.id)
        result = await db.execute(query)
        mosque = result.scalar_one_or_none()
        if not mosque:
            raise HTTPException(status_code=404, detail="المسجد غير موجود")
        await db.delete(mosque)
        await db.commit()
        return {"message": "تم حذف المسجد بنجاح"}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error deleting mosque: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ---------- Admin: Seed initial data ----------
@router.post("/seed")
async def seed_locations(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Seed the regions and mosques data. Admin only. Skips existing regions."""
    await require_admin(request, db)

    SEED_DATA = {
        "مبارك الكبير": [
            "بريدة بن الحصيب", "عبدالرحمن بن جوشن الغطفاني", "حارث بن النعمان",
            "خزيمة بن اوس بن زيد بن اّصرم", "محمد مسلم السبيعي وزوجته",
            "محمد بن سعد بن منيع الزهري", "هشام بن عامر بن أمية بن زيد",
            "رافع بن الحارث", "عبدالمحسن راشد المنيع", "سنان بن أبي سنان",
            "الدكتور عبدالله محمد العتيبي", "كعب بن زهير", "رافع بن عمرو الغفاري",
            "محمد بن اسحاق", "جمال الدين بن هشام", "الامام ابن المنذر",
            "عمرو بن اخطب الانصاري",
            "أم المؤمنين عائشة بنت ابي بكر الصديق رضي الله عنهما",
            "سعد الدين التفتازاني", "حسين العتيبي بيضه العتيبي",
            "ناشي مرضي العازمي", "عبدالعزيز أحمد عبدالعزيز الموسى السيف",
            "نعيم بن مسعود", "أبي سيف القين", "كمال الدين بن الهمام",
            "محمد حماد الحماد", "على ماطر مطيران", "جامع القدس(جعفري)",
        ],
        "غرب ابو فطيره الحرفية": [
            "الصحابي الجليل ربيعة بن كعب الاسلمي",
            "الصحابي الجليل عقبة بن عمرو الانصاري",
            "الصحابي الجليل عبدالجبار بن الحرث",
            "الاحسان (مقبرة صبحان)",
        ],
        "صبحان الصناعية": [
            "فارس فريح الوقيان", "محمود شكري الالوسي", "الدعوة",
        ],
        "صبحان": [
            "نادي الصيد و الفروسية", "ديوانية شعراء النبط",
        ],
        "صباح السالم": [
            "يعقوب يوسف اسماعيل", "فضيلة عبدالوهاب السابج",
            "منيرة عبدالعزيز الميلم", "سعود فهد سالم العجمي",
            "امينة وشريفة محمد كلندر", "راشد رجا الخياط",
            "رافع بن خديج الانصاري", "سهل بن بيضاء",
            "ثمامة بن اثال الحنفي", "سليمان خلف مال الله",
            "احمد الصباح السلمان الصباح",
            "زهره محمد بهجت زوجة يوسف محمد النصر الله",
            "سلطان بن عيسى", "مستورة زوجة سالم الدواي",
            "فرح مشعل المرزوق", "طيبه يوسف النصر الله",
            "وكيع بن الجراح", "تميم بن اوس الداري",
            "يوسف العبدالله وزوجته مريم الغنيمان", "الربيع",
            "الامام الترمذي", "معبد الخزاعي",
            "سفينة مولى رسول الله ﷺ", "الطفيل بن عمرو الدوسي",
            "احمد ماجد الغانم", "صالح احمد محمد الكندري",
            "عمر بن عمير رضي الله عنه", "ابراهيم على السبتي",
            "الهدهود و العوضي", "موزة يوسف النصر الله",
            "حسن احمد ابراهيم", "ابو بصير",
            "حمد حمدان العتيبي", "ثابت بن الضحاك",
            "حمد سالم جبر الهاجري", "عبدالله سلمان الكحلاوي",
            "ابو الفضل العباس بن على بن ابي طالب (جعفري)",
        ],
        "المسيلة": [
            "احمد محمد الغانم",
        ],
        "المسايل": [
            "فهد ابراهيم عبدالرحمن التويجري", "عائشة عبدالله المحري",
            "صبيحة ساكت هلول العصيمي", "عادلة محمد عبدالرحمن البحر",
            "طلال المعاود المطيري", "عبدالله على حمود السهو",
            "على مطلق ابوثنين السبيعي", "بدرية دعيج السلمان الصباح",
            "سيد حسن الزلزلة (جعفري)",
        ],
        "القصور": [
            "سلمى سعران الدماك", "سعد بن قويفل العجمي",
            "الشيخة صبيحة العبدالله الاحمد الصباح", "مجاشع بن مسعود",
            "مهاجر بن ابي امية", "عبدالعزيز محمد الشيحه",
            "احمد العجيل البراء بن عازب", "ماضي العجمي",
            "الحافظ ابن كثير", "صالح بن العباس عبد المطلب",
            "الخطيب البغدادي", "ابن الجوزي",
            "حرام بن ملحان", "مركز شباب القصور",
            "ابراهيم عمر الملا", "الامام ابن خزيمة",
            "ثعلبة بن عمرو بن محصن", "الحارث بن عمرو الانصاري",
            "صيفي بن عامر",
        ],
        "القرين": [
            "محمد بن كعب القرظي", "القاضي الباقلاني",
            "مجلس الوزراء", "عبدالله نواهي محمد العتيبي",
            "الحافظ ابن شهاب الزهري", "طلحة بن عتبة الانصاري",
            "ابو اسحاق الاسفراييني", "حماد بن ابي زيد",
            "عقبة بن وهب", "محمد فلاح الدلك",
            "نور الدين زنكي", "سهل بن حنيف",
            "معتق مقذل العازمي", "رفاعة بن الحارث",
            "صفوان بن اليمان",
        ],
        "الفنيطيس": [
            "فالح ناصر السبيعي", "فاطمة حسن احمد ابراهيم",
            "عائشة حسن احمد ابراهيم", "امينة محمد احمد العوضي",
            "عبدالمحسن براك الزبن وجدته لؤلؤة جاسم الجبر",
            "فهد عبدالعزيز المسعود", "عبدالرحمن عبدالله الزيد",
            "نورة حمد محمد العبدلي", "مروي ملفي الهدية",
            "عبدالعزيز عبدالرزاق المطوع", "عيسى يوسف العثمان",
            "غصاب محمد الزمانان",
        ],
        "العدان": [
            "عمرو بن دينار", "عامر بن بكير",
            "عيد عكرش العازمي", "عامر عبيد مانع العازمي",
            "جمال الدين الاسنوي",
            "سليمان احمد الفهد وزوجته سبيكة سعود الفهد",
            "الحافظ ضياء الدين المقدسي",
            "اشعث بن عبدالماللك الحمراني",
            "الحسين بن علي بن ابي طالب",
            "الشيخة موزة صباح الجابر الصباح",
            "الحارث بن مالك",
            "عبدالماللك بن عبدالله بن يوسف (امام الحرمين الجويني)",
            "الامام الشاطبي",
            "محمد بن علي بن ابي طالب (ابن الحنفية)",
            "العز بن عبدالسلام",
            "السيدة كوثر حميم ابراهيم الحميم",
            "القاضي يوسف (يعقوب بن ابراهيم)",
            "فخر الدين الرازي", "سيف الدين قطز",
            "القاضي عياض بن موسى بن عياض",
            "خنيس بن حذافة", "الامام ابن حزم",
            "سيد هاشم بهباني (جعفري)",
        ],
        "ابو فطيرة": [
            "احمد محمد البحر", "عبدالله وعبدالرزاق على الكزيني",
            "عبدالله خلف الساير الحربي", "منصور الربيع السبيعي",
            "عبداللطيف عبدالعزيز المزيني", "طيبة محمد البرجس",
            "يوسف محمد على العثمان", "فهد وفاطمة محمد الجافور",
            "احمد المنصور", "معدي العديدي",
            "شاهه عبدالعالي العتيبي",
            "يوسف يعقوب المطوع وموضى يوسف المطوع",
            "منصور البذال", "شيخة سلطان الدبوس",
            "الشيخة خليفة صباح الصباح",
        ],
        "ابو الحصانية": [
            "منيرة يوسف النصر الله", "حمد الصالح البراهيم",
            "عبدالعزيز عبدالله السند", "هيا العبداللطيف الابراهيم",
        ],
    }

    try:
        now = datetime.now(timezone.utc)
        created_regions = 0
        created_mosques = 0

        for region_name, mosque_names in SEED_DATA.items():
            # Check if region already exists
            existing_query = select(Regions).where(Regions.name == region_name)
            existing_result = await db.execute(existing_query)
            region = existing_result.scalar_one_or_none()

            if not region:
                region = Regions(name=region_name, created_at=now)
                db.add(region)
                await db.flush()
                created_regions += 1

            # Add mosques that don't exist yet
            for mosque_name in mosque_names:
                existing_mosque = await db.execute(
                    select(Mosques).where(
                        Mosques.name == mosque_name,
                        Mosques.region_id == region.id,
                    )
                )
                if not existing_mosque.scalar_one_or_none():
                    mosque = Mosques(
                        name=mosque_name,
                        region_id=region.id,
                        created_at=now,
                    )
                    db.add(mosque)
                    created_mosques += 1

        await db.commit()
        return {
            "message": f"تم إضافة {created_regions} منطقة و {created_mosques} مسجد بنجاح",
            "regions_created": created_regions,
            "mosques_created": created_mosques,
        }
    except Exception as e:
        await db.rollback()
        logger.error(f"Error seeding locations: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))