# ผลศึกษา CKAN API และ ckanext-thai_gdc สำหรับสร้าง MCP

ทดสอบเมื่อ 2026-11-03 ด้วยการอ่านอย่างเดียวและไม่ใช้ token ดังนั้น **ยังไม่ได้ทดสอบการเขียนจริง**

ที่มาของข้อมูล: **[ทดสอบ]** เรียก API จริง, **[โค้ด]** อ่านจาก ckanext-thai_gdc v3.1.0 (ยังไม่ได้ทดสอบจริง), **[เอกสาร]** docs.ckan.org

## 1. API พื้นฐาน

- รูปแบบ URL: `https://{site}/api/3/action/{action}` [เอกสาร]
- action กลุ่มอ่านใช้ GET ได้ ส่วนการเขียนใช้ POST แบบ JSON (อัปโหลดไฟล์ใช้ multipart) [เอกสาร]
- ยืนยันตัวตนด้วย header `Authorization: <token>` และสิทธิ์เท่ากับผู้ใช้เจ้าของ token [เอกสาร]
- ผลลัพธ์อยู่ในรูป `{help, success, result}` หรือ `{help, success: false, error: {__type, message}}` [ทดสอบ]

### การจัดการ error

เอกสารบอกว่าปกติตอบ HTTP 200 แต่ของจริงไม่เป็นแบบนั้น client จึงต้องไม่ถือว่าทุกคำตอบเป็น JSON [ทดสอบ]

| กรณี | ผลที่ได้ |
|---|---|
| ไม่พบข้อมูล | 404 + JSON (`Not Found Error`) |
| ไม่มีสิทธิ์ | 403 + JSON (`Authorization Error`) |
| ค่าไม่ถูกต้อง | 409 + JSON (`Validation Error`, คีย์เป็นชื่อฟิลด์) |
| action ไม่มีในไซต์ | 400 + **ข้อความธรรมดา** |
| action ที่บังคับ POST แต่เรียก GET | 400 + **ข้อความธรรมดา** |
| 400/403/404 บน gdcatalog.go.th | **หน้า HTML** |
| data.go.th รับโหลดไม่ไหว | 502 ข้อความธรรมดา หรือ timeout |

ข้อความ error บนไซต์ไทยเป็นภาษาไทย จึงควรแยกประเภทด้วย `__type` ไม่ใช่ข้อความ

## 2. ไซต์ที่ทดสอบ

| ไซต์ | CKAN | Thai GDC | ชุดข้อมูล | หมายเหตุ |
|---|---:|---:|---:|---|
| catalog.nso.go.th | 2.10.7 | 3.0.0 (`agency`) | 914 | มี DataStore ใช้งานมาก |
| kalasin.gdcatalog.go.th | 2.10.10 | 3.1.0 (`area_based`) | 408 | มี `reference_url_catalog` |
| statprovince.gdcatalog.go.th | 2.10.7 | 3.0.0 (`agency`) | 560 | |
| gdcatalog.go.th | 2.9.2 | ไม่แสดงเวอร์ชัน | 25,255 | ส่วนใหญ่มีแต่ metadata |
| data.go.th | 2.10.1 | ไม่ใช้ thai_gdc (ใช้ `tgdcschema`) | ไม่ได้นับ | ไม่เสถียรเมื่อขอข้อมูลเยอะ |
| demo.ckan.org | 2.11.5 | ไม่มี | 13 | CKAN ปกติ ไม่มี scheming |

เนื่องจากแต่ละไซต์ความสามารถไม่เท่ากัน MCP ควรตรวจ `status_show.extensions` ก่อนเรียก action เสริม

## 3. action ที่ควรใช้

| งาน | action | ข้อสังเกต |
|---|---|---|
| ข้อมูลไซต์ | `status_show` | thai_gdc เพิ่มประเภท catalog และเวอร์ชัน |
| ค้นชุดข้อมูล | `package_search` | ใช้ `q`, `fq`, `rows`, `start`, `sort`, `facet.field` |
| รายละเอียดชุดข้อมูล | `package_show` | รับได้ทั้ง name และ UUID |
| รายละเอียดไฟล์ | `resource_show`, `resource_view_list` | |
| โครงสร้างตาราง | `datastore_info` | ได้ฟิลด์ ชนิด และจำนวนแถว |
| ดึงข้อมูลในตาราง | `datastore_search` | ดูข้อ 5 |
| หน่วยงาน กลุ่ม | `organization_list`, `group_list`, `*_show` | |
| แท็ก | `tag_list?query=` | ดูข้อ 4 |
| คำแนะนำการค้น | `discovery_search_suggest` | เฉพาะไซต์ที่มี thai_gdc |
| schema | `scheming_dataset_schema_show?type=dataset` | ราว 92 KB ควรย่อและ cache |
| ดาวน์โหลดทั้งตาราง | `/datastore/dump/{id}` | ไม่ใช่ Action API |

action อื่นที่ตรวจแล้ว:

- `datastore_search_sql` **ใช้ไม่ได้ทั้ง 6 ไซต์** [ทดสอบ]
- `dcat_catalog_search` ตอบ XML 1.2 MB แม้ขอ `rows=1` จึงไม่ควรใช้ [ทดสอบ]
- `user_list`, `config_option_show` ถูกปฏิเสธเมื่อไม่มี token [ทดสอบ]

## 4. สิ่งที่ thai_gdc เปลี่ยนจาก CKAN ปกติ

**การค้นหา**
- `before_dataset_search` แปลงคำภาษาไทยใน `q` เป็น `text:*คำ*` แต่จะ**ข้ามการแปลง**ถ้ามีอักขระพิเศษอย่าง `:` หรือ `*` [โค้ด]
- ผลที่เห็นบน NSO [ทดสอบ]:

| คำค้น | จำนวนผล |
|---|---:|
| `q=ประชากร` | 331 |
| `q=title:ประชากร` | **0** |
| `q=title:"ประชากร"` | **0** |
| `q=title:*ประชากร*` | 137 |

- `tag_list` ที่ไม่ส่ง `query` ได้ผลว่างบนไซต์ thai_gdc แต่บน data.go.th ได้ 32,853 แท็ก (3.4 MB) จึงควรบังคับส่ง `query` เสมอ [ทดสอบ]

**ค่าของฟิลด์เป็นภาษาไทย** [ทดสอบ]
- `fq=data_type:stat` ได้ **0** ส่วน `fq=data_type:"ข้อมูลสถิติ"` ได้ 558
- `update_frequency_unit`, `geo_coverage`, `data_category` และอื่น ๆ ก็เป็นค่าไทยเช่นกัน ให้ดึงตัวเลือกจาก schema อย่า hardcode

**การสร้างชุดข้อมูล**
- ฟิลด์บังคับใน schema มากกว่า CKAN ปกติ: `data_type`, `title`, `maintainer`, `maintainer_email`, `tag_string`, `notes`, `objective`, `update_frequency_unit`, `geo_coverage`, `data_source`, `data_format`, `data_category`, `license_id` และต้องมี `owner_org` [ทดสอบ]
- `name` ยาวได้ไม่เกิน **70** ตัวอักษร ชื่อที่อยู่ในถังขยะก็ยังใช้ซ้ำไม่ได้ [โค้ด]
- `title` ห้ามซ้ำ เว้นแต่ตั้ง `thai_gdc.allow_duplicate_package_title` หรือเป็น `local_government` [โค้ด]
- ชุดข้อมูลไม่ต้องมี resource ก็ได้ และ state ถูกตั้งเป็น `active` ทุกครั้งที่สร้างหรือแก้ไข จึงไม่มีสถานะ draft [โค้ด]
- `allow_harvest` เป็นสตริง `"True"`/`"False"` [ทดสอบ]

**สิทธิ์**
- `package_delete` เรียกไปถาม harvester กลาง ถ้าเรียกไม่สำเร็จจะ**ปฏิเสธการลบ** [โค้ด]
- resource ที่มี `resource_private` อาจถูกซ่อนจากผลลัพธ์ (ขึ้นกับการตั้งค่า) [โค้ด]
- ผู้ใช้ `svc-{site_id}-gdharvester` เห็นชุดข้อมูล private ได้แม้ไม่ใช่สมาชิก **ห้ามนำ token นี้มาใช้กับ MCP** [โค้ด]

**ค่าที่ extension บังคับ** [โค้ด]
- `ckan.datastore.search.rows_max = 10000` (ค่าเริ่มต้น CKAN คือ 32000)
- มีการ log ค้นหาเฉพาะหน้าเว็บ ไม่รวม API

## 5. ข้อจำกัดด้านขนาดข้อมูล

- หนึ่งชุดข้อมูลมีขนาดราว **18-22 KB** เพราะมีหลายฟิลด์ [ทดสอบ]
- `rows=1000` บน gdcatalog ได้ 23 MB และ NSO 914 รายการได้ 16.5 MB ใช้เวลา 22 วินาที ส่วน data.go.th timeout ที่ `rows=5000` [ทดสอบ]
- gdcatalog ตอบไม่เกิน 1,000 แถวต่อครั้ง [ทดสอบ]
- `organization_list` บน gdcatalog ตอบไม่เกิน 200 รายการต่อครั้ง และขอหน้าถัดไปด้วย `offset` ได้ [ทดสอบ]

**DataStore** [ทดสอบ]
- รองรับ `q` ภาษาไทย, `filters`, `fields`, `sort`, `distinct`, `records_format=csv`
- ชื่อฟิลด์ใน `filters` ผิดจะได้ 409 จึงควรตรวจกับ `datastore_info` ก่อน
- ค่าตัวเลขอาจถูกเก็บเป็น text เช่น `year = "2565Q2"`
- สัดส่วน resource ที่ `datastore_active` จาก 100 ชุดข้อมูลแรกของแต่ละไซต์: NSO 431/698, kalasin 99/174, gdcatalog **5/532**
- จึงต้องมีทางเลือกเมื่อไม่มี DataStore โดยส่ง URL ของไฟล์กลับไป URL อาจอยู่นอกไซต์ เช่น `catalogapi.nso.go.th`

**Federation** [ทดสอบ]
- `fq=reference_url_catalog:https\://catalog.nso.go.th*` บน kalasin ได้ 18 รายการ
- `reference_url_catalog:*` ได้ 78 รายการ แต่บางรายการมีค่าเป็น `"-"` จึงไม่ควรนับจากการมีฟิลด์นี้อย่างเดียว

## 6. ข้อมูลใน skill `thai-government-ckan` ที่ควรแก้

| ใน skill | ที่พบ |
|---|---|
| `data_type` เป็น `stat`, `record`, `gis`... | เป็นค่าไทย เช่น `ข้อมูลสถิติ` |
| `update_frequency_unit` เป็น `year`, `month`... | เป็นค่าไทย เช่น `ปี`, `เดือน` |
| ฟิลด์บังคับมี `name`, `owner_org`, `title` | มีมากกว่านั้นมาก (ข้อ 4) |
| ตัด name ที่ 100 ตัวอักษร | validator จำกัด 70 |
| statprovince ไม่มี `reference_url_catalog` | schema ปัจจุบันมีแล้ว ไซต์ที่ไม่มีใน schema คือ gdcatalog.go.th |
| upsert ด้วยการลบ resource แล้วสร้างใหม่ | resource ID เปลี่ยน ลิงก์และ DataStore เดิมหายไป ควรพิจารณาจับคู่ตาม URL แล้วอัปเดตแทน |

## 7. แนวทางออกแบบ MCP

**หลักการ**
- ทุก tool รับ `site` ที่ต้องอยู่ใน allowlist เพื่อกัน SSRF
- ตอบแบบย่อเป็นค่าเริ่มต้น และมี `detail: "full"` เมื่อต้องการทั้งหมด
- จำกัด `rows` ไม่เกิน 50 และคืนข้อมูลแบ่งหน้า (`total`, `has_more`, `next_offset`)
- แปลง error ทุกแบบในข้อ 1 ให้เป็นข้อความที่บอกวิธีแก้ได้
- Cache schema และ `status_show`

**เฟส 1: อ่านอย่างเดียว ไม่ต้องใช้ token**

| Tool | ใช้ action |
|---|---|
| `ckan_list_sites` | config |
| `ckan_site_info` | `status_show` |
| `ckan_search_datasets` | `package_search` (มีตัวกรองแบบ typed, จัดการคำค้นไทยตามข้อ 4, facets) |
| `ckan_get_dataset` | `package_show` |
| `ckan_get_resource` | `resource_show` + `datastore_info` |
| `ckan_query_data` | `datastore_search` |
| `ckan_list_organizations` | `organization_list` / `organization_autocomplete` |
| `ckan_list_groups` | `group_list` / `group_autocomplete` |
| `ckan_search_tags` | `tag_list`, `discovery_search_suggest` |
| `ckan_get_schema` | `scheming_dataset_schema_show` (แบบย่อ) |
| `ckan_find_federated_copies` | `package_search` + `reference_url_catalog` |

**เฟส 2: เขียน ใช้ token แยกตามไซต์ และเปิดด้วย config เท่านั้น**
- `ckan_validate_dataset` (ตรวจกับ schema โดยไม่ส่งขึ้นระบบ), `ckan_create_dataset`, `ckan_patch_dataset`, `ckan_upsert_resource`, `ckan_ensure_organization`, `ckan_delete_dataset` (`package_delete`)
- ใช้ `package_patch` ไม่ใช้ `package_update` เพราะ update อาจลบฟิลด์ที่ไม่ได้ส่ง
- **ไม่เปิด `dataset_purge`** เพราะย้อนกลับไม่ได้
- ระบุ `destructiveHint` ให้ถูกต้อง และทดสอบบน `trainingarea*.gdcatalog.go.th` ก่อน

**ตัวเลือกเทคโนโลยี**: TypeScript กับ MCP SDK v2 ตามที่ mcp-builder แนะนำ ใช้ stdio ก่อนแล้วเพิ่ม Streamable HTTP ภายหลัง

## 8. ยังไม่ได้ศึกษา

- การเขียนทุกแบบ รวมถึงพฤติกรรม token บนไซต์ที่เปิด 2FA (`thaigdc2fa`)
- `opend/opendxmedai`, `opend/ckanext-harvest`, `opend/ckanext-xloader`, คู่มือ PDF และหน้าย่อยของ gdhelppage
- รายชื่อไซต์ครบ 76 จังหวัด (ทดสอบจริงเฉพาะ kalasin)
- โค้ดของ MCP ที่มีอยู่แล้ว (ดูจากหน้ารวมรายการเท่านั้น): `aborruso/ckan-mcp-server`, `ondics`, `openascot/ckan-mcp` และโครงการของ OKFN

## 9. ลิงก์

- [ckanext-thai_gdc](https://gitlab.nectec.or.th/opend/ckanext-thai_gdc) (v3.1.0, 2026-06-22, AGPLv3, สำหรับ CKAN 2.10.7 / Python 3.9)
- [installing-ckan](https://gitlab.nectec.or.th/opend/installing-ckan) วิธีติดตั้งและตั้งค่า extension
- [ckan-docker-thai-gdc](https://gitlab.nectec.or.th/opend/ckan-docker-thai-gdc) ใช้ตั้งไซต์ทดสอบในเครื่องได้
- [training/gdcatalog](https://gitlab.nectec.or.th/opend/training/gdcatalog) เอกสารอบรมการพัฒนา
- [ckanext-thaigdc_governance](https://gitlab.nectec.or.th/opend/ckanext-thaigdc_governance) สิทธิ์ตามระดับชั้นข้อมูล (README ระบุว่าใช้กับ CKAN 2.9.5)
- [GD Catalog Help](https://gdhelppage.gdcatalog.go.th)
- [CKAN API](https://docs.ckan.org/en/latest/api/index.html), [DataStore API](https://docs.ckan.org/en/latest/maintaining/datastore.html)
