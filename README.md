# ckan-thaigdc-mcp

MCP server สำหรับค้นหาและอ่านข้อมูลจาก CKAN โดยออกแบบมาสำหรับระบบบัญชีข้อมูลภาครัฐของไทยที่ใช้ [ckanext-thai_gdc](https://gitlab.nectec.or.th/opend/ckanext-thai_gdc) และใช้กับ CKAN ทั่วไปได้ด้วย

เวอร์ชันนี้**อ่านอย่างเดียว** ไม่ส่ง token และเห็นเฉพาะข้อมูลสาธารณะ

## สิ่งที่ทำได้

| Tool | หน้าที่ |
|---|---|
| `ckan_list_sites` | แสดงไซต์ที่ตั้งค่าไว้ |
| `ckan_site_info` | เวอร์ชัน ประเภท catalog จำนวนชุดข้อมูล และความสามารถของไซต์ |
| `ckan_search_datasets` | ค้นชุดข้อมูล พร้อมตัวกรองและการนับตามหมวด |
| `ckan_get_dataset` | ดู metadata และรายการไฟล์ของชุดข้อมูล |
| `ckan_get_resource` | ดูรายละเอียดไฟล์ คอลัมน์ และจำนวนแถว |
| `ckan_query_data` | ดึงข้อมูลในตาราง กรอง เรียง และหาค่าที่ไม่ซ้ำ |
| `ckan_list_organizations` | แสดงหรือค้นหน่วยงาน |
| `ckan_list_groups` | แสดงหรือค้นกลุ่ม |
| `ckan_search_tags` | ค้นแท็กและคำค้นที่ระบบแนะนำ |
| `ckan_get_schema` | ดูฟิลด์ metadata ฟิลด์บังคับ และค่าที่เลือกได้ |
| `ckan_find_federated_copies` | หาชุดข้อมูลที่ส่งต่อไปยัง catalog อื่นด้วย `reference_url_catalog` |

ตัวอย่างคำถาม:

- "ใน NSO มีชุดข้อมูลเกี่ยวกับประชากรที่มีไฟล์ CSV อะไรบ้าง"
- "ขอร้อยละครัวเรือนที่มีแท็บเล็ตของภาคเหนือ เรียงจากมากไปน้อย"
- "จังหวัดกาฬสินธุ์รับชุดข้อมูลอะไรจาก NSO บ้าง"

## ติดตั้ง

ต้องมี [Node.js](https://nodejs.org) 20.3 ขึ้นไป

```bash
git clone https://github.com/nungsatick/ckan-thaigdc-mcp.git
```

```bash
cd ckan-thaigdc-mcp
```

```bash
npm install
```

`npm install` จะ build ให้เองที่ `dist/index.js` จากนั้นดู path เต็มของไฟล์นี้ไว้ใช้ในขั้นตอนถัดไป

```bash
node -e "console.log(require('path').resolve('dist/index.js'))"
```

ตัวอย่างด้านล่างใช้ `C:/path/to/ckan-thaigdc-mcp/dist/index.js` ให้เปลี่ยนเป็น path ของคุณ บน Windows ใช้ `/` ได้เลย

## ตั้งค่ากับ AI แต่ละตัว

### Claude Code

```bash
claude mcp add --env "CKAN_SITES=nso=https://catalog.nso.go.th,gdcatalog=https://gdcatalog.go.th" --transport stdio --scope user ckan-thaigdc -- node C:/path/to/ckan-thaigdc-mcp/dist/index.js
```

ตรวจสอบด้วยคำสั่งนี้ หรือพิมพ์ `/mcp` ใน Claude Code

```bash
claude mcp get ckan-thaigdc
```

- `--scope user` ใช้ได้ทุกโปรเจกต์ ถ้าต้องการแชร์เฉพาะโปรเจกต์ให้ใช้ `--scope project` ซึ่งจะสร้าง `.mcp.json`
- ถ้าจะใช้ไซต์เริ่มต้นทั้งหมด ไม่ต้องใส่ `--env`

### Claude Desktop

1. เปิด **Settings > Developer > Edit Config** แล้วเพิ่มส่วนนี้ลงในไฟล์ที่เปิดขึ้นมา

```json
{
  "mcpServers": {
    "ckan-thaigdc": {
      "command": "node",
      "args": ["C:/path/to/ckan-thaigdc-mcp/dist/index.js"],
      "env": {
        "CKAN_SITES": "nso=https://catalog.nso.go.th,gdcatalog=https://gdcatalog.go.th"
      }
    }
  }
}
```

2. ปิด Claude Desktop ให้สนิทรวมถึงที่ system tray แล้วเปิดใหม่

ไฟล์นี้ปกติอยู่ที่ `%APPDATA%\Claude\claude_desktop_config.json` แต่ถ้าติดตั้งจาก Microsoft Store อาจอยู่ที่อื่น จึงควรเปิดผ่านเมนู Edit Config ถ้ามี `mcpServers` อยู่แล้ว ให้เพิ่มเฉพาะ `ckan-thaigdc` เข้าไป

### Codex (CLI, IDE extension, ChatGPT desktop)

ทั้งสามตัวใช้ไฟล์ตั้งค่าเดียวกันคือ `~/.codex/config.toml` (Windows: `%USERPROFILE%\.codex\config.toml`) ให้เพิ่มส่วนนี้

```toml
[mcp_servers.ckan-thaigdc]
command = "node"
args = ["C:/path/to/ckan-thaigdc-mcp/dist/index.js"]

[mcp_servers.ckan-thaigdc.env]
CKAN_SITES = "nso=https://catalog.nso.go.th,gdcatalog=https://gdcatalog.go.th"
```

หรือเพิ่มด้วยคำสั่ง

```bash
codex mcp add ckan-thaigdc --env "CKAN_SITES=nso=https://catalog.nso.go.th,gdcatalog=https://gdcatalog.go.th" -- node C:/path/to/ckan-thaigdc-mcp/dist/index.js
```

ตรวจสอบด้วยคำสั่งนี้ หรือพิมพ์ `/mcp` ใน Codex

```bash
codex mcp list
```

### Google Antigravity

1. เปิดไฟล์ตั้งค่า
   - **IDE:** กด **…** ด้านบนแผง agent > **MCP Servers** > **Manage MCP Servers** > **View raw config**
   - **App หรือ CLI:** แก้ไฟล์ `~/.gemini/config/mcp_config.json` โดยตรง (Windows: `%USERPROFILE%\.gemini\config\mcp_config.json`)
2. เพิ่มส่วนนี้

```json
{
  "mcpServers": {
    "ckan-thaigdc": {
      "command": "node",
      "args": ["C:/path/to/ckan-thaigdc-mcp/dist/index.js"],
      "env": {
        "CKAN_SITES": "nso=https://catalog.nso.go.th,gdcatalog=https://gdcatalog.go.th"
      }
    }
  }
}
```

3. โหลดใหม่
   - **App:** **Settings > Customizations > Installed MCP Servers** แล้วกดปุ่ม refresh
   - **CLI:** พิมพ์ `/mcp` แล้วเลือกโหลดใหม่
   - **IDE:** ถ้ายังไม่เห็น tools ให้ปิดแล้วเปิดใหม่

Antigravity รุ่นเก่าใช้ไฟล์ `~/.gemini/antigravity/mcp_config.json` ถ้าแก้แล้วไม่เห็นผล ให้ใช้เมนู View raw config เพื่อดูว่ารุ่นของคุณอ่านไฟล์ใด

### AI อื่น ๆ

โปรแกรมที่รองรับ MCP แบบ stdio ส่วนใหญ่ใช้ค่าเดียวกันนี้: `command` คือ `node`, `args` คือ path ของ `dist/index.js` และ `env` คือ `CKAN_SITES`

## เลือกไซต์ด้วย CKAN_SITES

กำหนดในรูปแบบ `ชื่อย่อ=URL` คั่นด้วยจุลภาค server จะเรียกได้เฉพาะไซต์ในรายการนี้

```text
CKAN_SITES=nso=https://catalog.nso.go.th,kalasin=https://kalasin.gdcatalog.go.th,local=http://localhost:8881
```

- ใช้ `http://` ได้เฉพาะ `localhost` ส่วนไซต์อื่นต้องเป็น `https://`
- ถ้าไม่กำหนด จะใช้ `nso`, `gdcatalog`, `datagoth`, `statprovince`, `kalasin`

## แก้ปัญหาเบื้องต้น

| อาการ | สิ่งที่ควรตรวจ |
|---|---|
| ไม่เห็น tools | path ใน `args` ต้องเป็น path เต็ม และโปรแกรมต้องเริ่มใหม่หลังแก้ค่า |
| `node` not found | ใช้ path เต็มของ Node เป็น `command` ดูได้จาก `where node` (Windows) หรือ `which node` |
| `Cannot find module dist/index.js` | รัน `npm install` หรือ `npm run build` |
| `Unknown site` | เพิ่มไซต์นั้นใน `CKAN_SITES` |
| ไซต์ไม่ตอบ | ลองใหม่หรือลด `limit` บางไซต์ เช่น data.go.th อาจตอบช้าเมื่อขอข้อมูลมาก |

ทดสอบ server โดยไม่ต้องใช้ AI:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## พัฒนาต่อ

```bash
npm test
```

```bash
npm run build
```

`npm run smoke` เรียก tools ทุกตัวกับไซต์จริง เลือกไซต์ได้ด้วย `SMOKE_SITE` และ `CKAN_SITES`

ผลการศึกษา API และแผนเฟสถัดไปอยู่ใน [docs/ckan-api-research.md](docs/ckan-api-research.md)

## License

[MIT](LICENSE)
