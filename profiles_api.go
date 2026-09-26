package main

import (
	"errors"
	"fmt"

	"daimon/internal/storage"
	"gorm.io/gorm"
)

type ProfileGroupDTO struct {
	ID       string  `json:"id"`
	ParentID *string `json:"parentId,omitempty"`
	Name     string  `json:"name"`
	Order    int     `json:"order"`
}

type ProfileDTO struct {
	ID      string `json:"id"`
	GroupID string `json:"groupId"`

	Name string `json:"name"`

	Host     string `json:"host"`
	Port     int    `json:"port"`
	Username string `json:"username"`

	SSHOptionsJSON string `json:"sshOptionsJson"`

	CreatedAt string `json:"createdAt"` // RFC3339
	UpdatedAt string `json:"updatedAt"` // RFC3339
}

type UpsertProfileGroupRequest struct {
	ID       string  `json:"id,omitempty"`
	ParentID *string `json:"parentId,omitempty"`
	Name     string  `json:"name"`
	Order    int     `json:"order"`
}

type UpsertProfileRequest struct {
	ID      string `json:"id,omitempty"`
	GroupID string `json:"groupId"`

	Name string `json:"name"`

	Host     string `json:"host"`
	Port     int    `json:"port"`
	Username string `json:"username"`

	SSHOptionsJSON string `json:"sshOptionsJson"`
}

func (a *App) ensureDB() (*storage.Store, error) {
	if a.db == nil || a.db.DB == nil {
		return nil, errors.New("db not ready")
	}
	return a.db, nil
}

func (a *App) EnsureDefaultGroup() (*ProfileGroupDTO, error) {
	s, err := a.ensureDB()
	if err != nil {
		return nil, err
	}

	var cnt int64
	if err := s.DB.Model(&storage.ProfileGroup{}).Count(&cnt).Error; err != nil {
		return nil, err
	}
	if cnt > 0 {
		// return the first by order as “default”
		var g storage.ProfileGroup
		if err := s.DB.Order("`order` asc").First(&g).Error; err != nil {
			return nil, err
		}
		d := mapGroup(g)
		return &d, nil
	}

	g := storage.ProfileGroup{Name: "Default", Order: 0}
	if err := s.DB.Create(&g).Error; err != nil {
		return nil, err
	}
	d := mapGroup(g)
	return &d, nil
}

func (a *App) ListProfileGroups() ([]ProfileGroupDTO, error) {
	s, err := a.ensureDB()
	if err != nil {
		return nil, err
	}
	var groups []storage.ProfileGroup
	if err := s.DB.Order("`order` asc").Find(&groups).Error; err != nil {
		return nil, err
	}
	out := make([]ProfileGroupDTO, 0, len(groups))
	for _, g := range groups {
		out = append(out, mapGroup(g))
	}
	return out, nil
}

func (a *App) UpsertProfileGroup(req UpsertProfileGroupRequest) (ProfileGroupDTO, error) {
	s, err := a.ensureDB()
	if err != nil {
		return ProfileGroupDTO{}, err
	}
	if req.Name == "" {
		return ProfileGroupDTO{}, errors.New("name is required")
	}

	// create
	if req.ID == "" {
		g := storage.ProfileGroup{
			ParentID: req.ParentID,
			Name:     req.Name,
			Order:    req.Order,
		}
		if err := s.DB.Create(&g).Error; err != nil {
			return ProfileGroupDTO{}, err
		}
		return mapGroup(g), nil
	}

	// update
	var g storage.ProfileGroup
	if err := s.DB.First(&g, "id = ?", req.ID).Error; err != nil {
		return ProfileGroupDTO{}, err
	}
	g.ParentID = req.ParentID
	g.Name = req.Name
	g.Order = req.Order
	if err := s.DB.Save(&g).Error; err != nil {
		return ProfileGroupDTO{}, err
	}
	return mapGroup(g), nil
}

func (a *App) DeleteProfileGroup(id string) error {
	s, err := a.ensureDB()
	if err != nil {
		return err
	}
	if id == "" {
		return errors.New("id is required")
	}

	// prevent deletion if profiles exist
	var cnt int64
	if err := s.DB.Model(&storage.Profile{}).Where("group_id = ?", id).Count(&cnt).Error; err != nil {
		return err
	}
	if cnt > 0 {
		return fmt.Errorf("group contains %d profiles", cnt)
	}

	return s.DB.Delete(&storage.ProfileGroup{}, "id = ?", id).Error
}

func (a *App) ListProfiles() ([]ProfileDTO, error) {
	s, err := a.ensureDB()
	if err != nil {
		return nil, err
	}
	var profiles []storage.Profile
	if err := s.DB.Order("updated_at desc").Find(&profiles).Error; err != nil {
		return nil, err
	}
	out := make([]ProfileDTO, 0, len(profiles))
	for _, p := range profiles {
		out = append(out, mapProfile(p))
	}
	return out, nil
}

func (a *App) UpsertProfile(req UpsertProfileRequest) (ProfileDTO, error) {
	s, err := a.ensureDB()
	if err != nil {
		return ProfileDTO{}, err
	}
	if req.GroupID == "" {
		return ProfileDTO{}, errors.New("groupId is required")
	}
	if req.Name == "" {
		return ProfileDTO{}, errors.New("name is required")
	}
	if req.Host == "" {
		return ProfileDTO{}, errors.New("host is required")
	}
	if req.Port == 0 {
		req.Port = 22
	}
	if req.Username == "" {
		return ProfileDTO{}, errors.New("username is required")
	}
	if req.SSHOptionsJSON == "" {
		req.SSHOptionsJSON = "{}"
	}

	if req.ID == "" {
		p := storage.Profile{
			GroupID:        req.GroupID,
			Name:           req.Name,
			Host:           req.Host,
			Port:           req.Port,
			Username:       req.Username,
			SSHOptionsJSON: req.SSHOptionsJSON,
		}
		if err := s.DB.Create(&p).Error; err != nil {
			return ProfileDTO{}, err
		}
		return mapProfile(p), nil
	}

	var p storage.Profile
	if err := s.DB.First(&p, "id = ?", req.ID).Error; err != nil {
		return ProfileDTO{}, err
	}
	p.GroupID = req.GroupID
	p.Name = req.Name
	p.Host = req.Host
	p.Port = req.Port
	p.Username = req.Username
	p.SSHOptionsJSON = req.SSHOptionsJSON
	if err := s.DB.Save(&p).Error; err != nil {
		return ProfileDTO{}, err
	}
	return mapProfile(p), nil
}

func (a *App) DeleteProfile(id string) error {
	s, err := a.ensureDB()
	if err != nil {
		return err
	}
	if id == "" {
		return errors.New("id is required")
	}
	// delete secret refs & vault items
	_ = s.DB.Where("profile_id = ?", id).Delete(&storage.SecretRef{}).Error
	_ = s.DB.Where("profile_id = ?", id).Delete(&storage.VaultItem{}).Error
	return s.DB.Delete(&storage.Profile{}, "id = ?", id).Error
}

func (a *App) DuplicateProfile(id string, newName string) (ProfileDTO, error) {
	s, err := a.ensureDB()
	if err != nil {
		return ProfileDTO{}, err
	}
	if id == "" {
		return ProfileDTO{}, errors.New("id is required")
	}
	var p storage.Profile
	if err := s.DB.First(&p, "id = ?", id).Error; err != nil {
		return ProfileDTO{}, err
	}
	p.ID = ""
	if newName != "" {
		p.Name = newName
	} else {
		p.Name = p.Name + " (copy)"
	}
	if err := s.DB.Create(&p).Error; err != nil {
		return ProfileDTO{}, err
	}
	return mapProfile(p), nil
}

func (a *App) SaveUILayout(scope string, layoutJSON string) error {
	s, err := a.ensureDB()
	if err != nil {
		return err
	}
	if scope == "" {
		scope = "app"
	}
	if layoutJSON == "" {
		layoutJSON = "{}"
	}
	key := "layout:" + scope

	return s.DB.Transaction(func(tx *gorm.DB) error {
		var st storage.UILayoutState
		err := tx.First(&st, "scope = ?", scope).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			st = storage.UILayoutState{ID: key, Scope: scope, LayoutJSON: layoutJSON}
			return tx.Create(&st).Error
		}
		if err != nil {
			return err
		}
		st.LayoutJSON = layoutJSON
		return tx.Save(&st).Error
	})
}

func (a *App) LoadUILayout(scope string) (string, error) {
	s, err := a.ensureDB()
	if err != nil {
		return "", err
	}
	if scope == "" {
		scope = "app"
	}
	var st storage.UILayoutState
	err = s.DB.First(&st, "scope = ?", scope).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "{}", nil
	}
	if err != nil {
		return "", err
	}
	if st.LayoutJSON == "" {
		return "{}", nil
	}
	return st.LayoutJSON, nil
}

func mapGroup(g storage.ProfileGroup) ProfileGroupDTO {
	return ProfileGroupDTO{
		ID:       g.ID,
		ParentID: g.ParentID,
		Name:     g.Name,
		Order:    g.Order,
	}
}

func mapProfile(p storage.Profile) ProfileDTO {
	return ProfileDTO{
		ID:             p.ID,
		GroupID:        p.GroupID,
		Name:           p.Name,
		Host:           p.Host,
		Port:           p.Port,
		Username:       p.Username,
		SSHOptionsJSON: p.SSHOptionsJSON,
		CreatedAt:      p.CreatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt:      p.UpdatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
	}
}
