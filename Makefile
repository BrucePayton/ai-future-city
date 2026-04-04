# AIFutureCity 后端 Makefile
# 一键启动脚本

.PHONY: help install dev dev-all db-init db-reset build test clean

# 默认目标显示帮助
help:
	@echo "AIFutureCity 后端 Makefile"
	@echo ""
	@echo "可用命令:"
	@echo "  make install    - 安装依赖"
	@echo "  make dev        - 启动开发服务器（网关）"
	@echo "  make dev-all    - 启动所有服务（网关+Web+Client）"
	@echo "  make db-init    - 初始化数据库"
	@echo "  make db-reset   - 重置数据库（需手动确认）"
	@echo "  make build      - 构建生产版本"
	@echo "  make clean      - 清理缓存"

# 安装依赖
install:
	pnpm install

# 启动开发服务器（网关）
dev:
	pnpm dev:backend

# 启动所有服务
dev-all:
	@echo "启动所有后端服务..."
	pnpm dev:backend & pnpm dev:web & pnpm dev:client
	@echo "服务已启动: 网关(3001), Web, Client"

# 初始化数据库
db-init:
	@echo "初始化数据库..."
	@if [ -z "$$DATABASE_URL" ]; then \
		echo "请先设置 DATABASE_URL 环境变量"; \
		echo "例如: export DATABASE_URL=postgresql://user:pass@localhost:5432/aifc"; \
		echo "然后运行: pnpm exec psql -f backend/gateway/src/db/schema.sql"; \
	else \
		psql $$DATABASE_URL -f backend/gateway/src/db/schema.sql; \
	fi

# 重置数据库
db-reset:
	@echo "⚠️  警告：此操作会删除所有数据！"
	@read -p "确认删除数据库？[y/N] " confirm && [ "$$confirm" = "y" ] || exit 0
	@echo "数据库重置功能需要手动执行，请联系管理员"

# 构建生产版本
build:
	pnpm build

# 清理缓存
clean:
	rm -rf node_modules
	find . -name "dist" -type d -exec rm -rf {} + 2>/dev/null || true
	find . -name "*.tsbuildinfo" -delete 2>/dev/null || true
	@echo "清理完成"